mod backup;
mod db;
mod photocraft;
mod photos;
mod sales;

use base64::Engine;
use db::{Car, CollectionStats};
use image::DynamicImage;
use photos::{Edits, Photo, Processed};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

type CmdResult<T> = Result<T, String>;

pub struct AppState {
    conn: Mutex<Connection>,
    images_dir: PathBuf,
    /// Original aberto no editor (decodificar a cada ajuste deixaria o slider lento).
    editing: Arc<Mutex<Option<EditCache>>>,
}

struct EditCache {
    name: String,
    full: Arc<DynamicImage>,
    /// Versão menor, para as prévias instantâneas
    small: Arc<DynamicImage>,
}

/// Lado maior da versão usada nas prévias do editor.
const PREVIEW_SOURCE_MAX: u32 = 1100;

fn cached_original(
    cache: &Arc<Mutex<Option<EditCache>>>,
    dir: &std::path::Path,
    name: &str,
) -> CmdResult<(Arc<DynamicImage>, Arc<DynamicImage>)> {
    let mut guard = cache.lock().map_err(err)?;
    if let Some(c) = guard.as_ref().filter(|c| c.name == name) {
        return Ok((c.full.clone(), c.small.clone()));
    }
    let full = Arc::new(photos::load(dir, name)?);
    let small = Arc::new(photos::fit((*full).clone(), PREVIEW_SOURCE_MAX));
    *guard = Some(EditCache { name: name.to_string(), full: full.clone(), small: small.clone() });
    Ok((full, small))
}

/// Roda processamento pesado fora da thread principal (a interface não trava).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

// ---------- Carros ----------

#[tauri::command]
fn list_cars(state: State<AppState>, collection: Option<String>) -> CmdResult<Vec<Car>> {
    let conn = state.conn.lock().map_err(err)?;
    db::list_cars(&conn, collection.as_deref()).map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CarInput {
    id: Option<String>,
    collection: Option<String>,
    name: String,
    #[serde(default)]
    description: String,
    quantity: i64,
    acquired_at: Option<String>,
    acquisition_price: Option<i64>,
    sale_price: Option<i64>,
    promo_price: Option<i64>,
    #[serde(default)]
    photos: Vec<Photo>,
}

#[tauri::command]
fn save_car(state: State<AppState>, car: CarInput) -> CmdResult<Car> {
    let name = car.name.trim().to_string();
    if name.is_empty() {
        return Err("Informe o nome do modelo.".into());
    }
    if car.photos.len() > db::MAX_PHOTOS {
        return Err(format!("No máximo {} fotos por modelo.", db::MAX_PHOTOS));
    }
    for p in &car.photos {
        for f in [&p.file, &p.original] {
            let ok = photos::safe_file_name(f).is_some() && state.images_dir.join(f).is_file();
            if !ok {
                return Err("Uma das fotos não foi encontrada. Adicione de novo.".into());
            }
        }
    }
    let mut conn = state.conn.lock().map_err(err)?;
    let existing = match &car.id {
        Some(id) => db::get_car(&conn, id).map_err(err)?,
        None => None,
    };
    let ts = now();
    let saved = Car {
        id: car.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        collection: car.collection.unwrap_or_else(|| "hotwheels".into()),
        name,
        description: car.description.trim().to_string(),
        quantity: car.quantity.max(0),
        acquired_at: car.acquired_at.filter(|s| !s.is_empty()),
        acquisition_price: car.acquisition_price,
        sale_price: car.sale_price,
        promo_price: car.promo_price,
        image_file: car.photos.first().map(|p| p.file.clone()),
        photos: car.photos,
        created_at: existing.as_ref().map(|c| c.created_at.clone()).unwrap_or_else(|| ts.clone()),
        updated_at: ts,
    };
    let tx = conn.transaction().map_err(err)?;
    db::upsert_car(&tx, &saved).map_err(err)?;
    tx.commit().map_err(err)?;

    // Apaga arquivos de fotos que saíram do cadastro (trocadas, removidas ou reeditadas)
    if let Some(old) = existing {
        let keep: HashSet<&String> = saved.photos.iter().flat_map(|p| [&p.file, &p.original]).collect();
        let referenced: HashSet<String> = db::referenced_images(&conn).unwrap_or_default().into_iter().collect();
        for f in old.photos.iter().flat_map(|p| [&p.file, &p.original]) {
            if !keep.contains(f) && !referenced.contains(f) {
                let _ = std::fs::remove_file(state.images_dir.join(f));
            }
        }
    }
    Ok(saved)
}

/// Atualiza só preços (usado na tela de catálogo).
#[tauri::command]
fn update_prices(
    state: State<AppState>,
    id: String,
    sale_price: Option<i64>,
    promo_price: Option<i64>,
) -> CmdResult<()> {
    let conn = state.conn.lock().map_err(err)?;
    conn.execute(
        "UPDATE cars SET sale_price = ?1, promo_price = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![sale_price, promo_price, now(), id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
fn update_quantity(state: State<AppState>, id: String, quantity: i64) -> CmdResult<()> {
    let conn = state.conn.lock().map_err(err)?;
    conn.execute(
        "UPDATE cars SET quantity = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![quantity.max(0), now(), id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
fn delete_car(state: State<AppState>, id: String) -> CmdResult<()> {
    let conn = state.conn.lock().map_err(err)?;
    let car = db::get_car(&conn, &id).map_err(err)?;
    db::delete_car(&conn, &id).map_err(err)?;
    let referenced: HashSet<String> = db::referenced_images(&conn).unwrap_or_default().into_iter().collect();
    for p in car.map(|c| c.photos).unwrap_or_default() {
        for f in [p.file, p.original] {
            if !referenced.contains(&f) {
                let _ = std::fs::remove_file(state.images_dir.join(f));
            }
        }
    }
    Ok(())
}

// ---------- Vendas ----------

#[tauri::command]
fn create_sale(state: State<AppState>, sale: sales::SaleInput) -> CmdResult<sales::Sale> {
    let mut conn = state.conn.lock().map_err(err)?;
    sales::create(&mut conn, sale)
}

#[tauri::command]
fn list_sales(state: State<AppState>) -> CmdResult<Vec<sales::Sale>> {
    let conn = state.conn.lock().map_err(err)?;
    sales::list(&conn).map_err(err)
}

#[tauri::command]
fn delete_sale(state: State<AppState>, id: String, restock: bool) -> CmdResult<()> {
    let mut conn = state.conn.lock().map_err(err)?;
    sales::delete(&mut conn, &id, restock).map_err(err)
}

#[tauri::command]
fn collection_stats(state: State<AppState>) -> CmdResult<Vec<CollectionStats>> {
    let conn = state.conn.lock().map_err(err)?;
    db::stats(&conn).map_err(err)
}

// ---------- Imagens ----------

#[tauri::command]
fn images_dir(state: State<AppState>) -> String {
    state.images_dir.to_string_lossy().into_owned()
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    token: &'a str,
    stage: &'a str,
}

fn import_bytes(app: AppHandle, state: &AppState, bytes: Vec<u8>, token: String) -> impl FnOnce() -> CmdResult<Processed> {
    let dir = state.images_dir.clone();
    move || {
        photos::import(&bytes, &dir, |stage| {
            let _ = app.emit("photo-progress", Progress { token: &token, stage });
        })
    }
}

/// Importa uma foto do disco: corrige orientação, guarda o original e gera a versão WebP.
#[tauri::command]
async fn photo_import_path(app: AppHandle, state: State<'_, AppState>, path: String, token: String) -> CmdResult<Processed> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Não consegui abrir {path}: {e}"))?;
    blocking(import_bytes(app, &state, bytes, token)).await
}

/// Importa uma foto colada (data URL / base64).
#[tauri::command]
async fn photo_import_base64(app: AppHandle, state: State<'_, AppState>, data: String, token: String) -> CmdResult<Processed> {
    let b64 = data.split_once(',').map(|(_, d)| d).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| "Imagem colada inválida.".to_string())?;
    blocking(import_bytes(app, &state, bytes, token)).await
}

#[derive(Serialize)]
struct Source {
    url: String,
    width: u32,
    height: u32,
}

/// O original (girado) para o editor desenhar os cantos do recorte por cima.
#[tauri::command]
async fn photo_source(state: State<'_, AppState>, original: String, rotate: u16, max_side: u32) -> CmdResult<Source> {
    let (cache, dir) = (state.editing.clone(), state.images_dir.clone());
    blocking(move || {
        let (full, small) = cached_original(&cache, &dir, &original)?;
        let src = if max_side <= PREVIEW_SOURCE_MAX { small } else { full };
        let img = photos::flatten_on_white(&photos::fit(photos::rotated(&src, rotate), max_side));
        Ok(Source { url: photos::jpeg_data_url(&img, 85)?, width: img.width(), height: img.height() })
    })
    .await
}

/// Prévia rápida do resultado com os ajustes (usa a versão menor do original).
#[tauri::command]
async fn photo_preview(state: State<'_, AppState>, original: String, edits: Edits, max_side: u32) -> CmdResult<String> {
    let (cache, dir) = (state.editing.clone(), state.images_dir.clone());
    blocking(move || {
        let (_, small) = cached_original(&cache, &dir, &original)?;
        photos::jpeg_data_url(&photos::render(&small, &edits, max_side), 82)
    })
    .await
}

/// Aplica os ajustes no original em resolução cheia e gera a foto final em WebP.
#[tauri::command]
async fn photo_render(state: State<'_, AppState>, original: String, edits: Edits) -> CmdResult<Processed> {
    let (cache, dir) = (state.editing.clone(), state.images_dir.clone());
    blocking(move || {
        let (full, _) = cached_original(&cache, &dir, &original)?;
        photos::render_to_file(&full, &original, &edits, &dir)
    })
    .await
}

/// Copia uma foto para a área de transferência (para mandar no privado do WhatsApp).
#[tauri::command]
async fn copy_photo(app: AppHandle, state: State<'_, AppState>, file: String) -> CmdResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let dir = state.images_dir.clone();
    let rgba = blocking(move || Ok(photos::load(&dir, &file)?.to_rgba8())).await?;
    let (w, h) = rgba.dimensions();
    let image = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
    app.clipboard().write_image(&image).map_err(err)
}

/// Devolve a imagem como data URL (para desenhar no canvas do catálogo sem bloqueio de CORS).
#[tauri::command]
async fn image_data_url(state: State<'_, AppState>, file: String) -> CmdResult<String> {
    let name = photos::safe_file_name(&file).ok_or("Imagem inválida")?;
    let bytes = std::fs::read(state.images_dir.join(name)).map_err(err)?;
    Ok(format!(
        "data:{};base64,{}",
        photos::mime_for(name),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// ---------- Configurações ----------

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<serde_json::Value> {
    let conn = state.conn.lock().map_err(err)?;
    db::get_settings(&conn).map_err(err)
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: serde_json::Value) -> CmdResult<()> {
    let conn = state.conn.lock().map_err(err)?;
    db::save_settings(&conn, &settings).map_err(err)
}

// ---------- Backup ----------

#[tauri::command]
async fn export_backup(state: State<'_, AppState>, dest: String) -> CmdResult<usize> {
    let conn = state.conn.lock().map_err(err)?;
    backup::export(&conn, &state.images_dir, &PathBuf::from(dest))
}

#[tauri::command]
async fn import_backup(
    state: State<'_, AppState>,
    src: String,
    replace: bool,
) -> CmdResult<backup::ImportResult> {
    let result = {
        let mut conn = state.conn.lock().map_err(err)?;
        backup::import(&mut conn, &state.images_dir, &PathBuf::from(src), replace)?
    };
    if replace {
        cleanup_orphan_images(&state);
    }
    Ok(result)
}

// ---------- Catálogo ----------

/// Grava as páginas (PNG em base64) do catálogo na pasta escolhida.
#[tauri::command]
async fn save_catalog_pages(dir: String, prefix: String, pages: Vec<String>) -> CmdResult<Vec<String>> {
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%Hh%M");
    let prefix: String = prefix
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let mut saved = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let b64 = page.split_once(',').map(|(_, d)| d).unwrap_or(page);
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(err)?;
        let path = dir.join(format!("{prefix}_{stamp}_{:02}.jpg", i + 1));
        std::fs::write(&path, bytes).map_err(err)?;
        saved.push(path.to_string_lossy().into_owned());
    }
    Ok(saved)
}

/// Copia uma imagem PNG (base64) para a área de transferência, pronta para colar no WhatsApp.
#[tauri::command]
async fn copy_image(app: tauri::AppHandle, png: String) -> CmdResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let b64 = png.split_once(',').map(|(_, d)| d).unwrap_or(&png);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(err)?;
    let image = tauri::image::Image::from_bytes(&bytes).map_err(err)?;
    app.clipboard().write_image(&image).map_err(err)
}

// ---------- Setup ----------

fn cleanup_orphan_images(state: &AppState) {
    let referenced: HashSet<String> = match state.conn.lock() {
        Ok(conn) => db::referenced_images(&conn).unwrap_or_default().into_iter().collect(),
        Err(_) => return,
    };
    let Ok(entries) = std::fs::read_dir(&state.images_dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !referenced.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let images_dir = data_dir.join("images");
            std::fs::create_dir_all(&images_dir)?;
            let conn = db::open(&data_dir.join("garimpalo.db"))?;
            let state = AppState { conn: Mutex::new(conn), images_dir, editing: Arc::new(Mutex::new(None)) };
            // Fotos escolhidas mas nunca salvas (formulário cancelado) são removidas ao abrir.
            cleanup_orphan_images(&state);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_cars,
            save_car,
            update_prices,
            update_quantity,
            delete_car,
            collection_stats,
            create_sale,
            list_sales,
            delete_sale,
            images_dir,
            photo_import_path,
            photo_import_base64,
            photo_source,
            photo_preview,
            photo_render,
            copy_photo,
            image_data_url,
            get_settings,
            save_settings,
            export_backup,
            import_backup,
            save_catalog_pages,
            copy_image,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Garimpalo");
}
