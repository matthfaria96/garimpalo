//! Exportar / importar tudo (dados + imagens) num único arquivo .zip.

use crate::db::{self, Car};
use crate::sales::{self, Sale};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

const DATA_FILE: &str = "garimpalo.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupData {
    format: String,
    version: i64,
    exported_at: String,
    cars: Vec<Car>,
    #[serde(default)]
    settings: serde_json::Value,
    #[serde(default)]
    sales: Vec<Sale>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub cars: usize,
    pub images: usize,
}

pub fn export(conn: &Connection, images_dir: &Path, dest: &Path) -> Result<usize, String> {
    let cars = db::list_cars(conn, None).map_err(|e| e.to_string())?;
    let settings = db::get_settings(conn).map_err(|e| e.to_string())?;
    let sales = sales::list(conn).map_err(|e| e.to_string())?;
    let data = BackupData {
        format: "garimpalo-backup".into(),
        version: db::SCHEMA_VERSION,
        exported_at: chrono::Local::now().to_rfc3339(),
        cars,
        settings,
        sales,
    };

    let file = File::create(dest).map_err(|e| format!("Não consegui criar o arquivo: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let json_opts = SimpleFileOptions::default();
    // JPEG já é comprimido: guardar sem recomprimir deixa a exportação bem mais rápida.
    let img_opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file(DATA_FILE, json_opts).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    zip.write_all(&json).map_err(|e| e.to_string())?;

    let mut written = HashSet::new();
    let files = data
        .cars
        .iter()
        .flat_map(|c| c.photos.iter())
        .flat_map(|p| [&p.file, &p.original])
        .chain(data.sales.iter().flat_map(|s| s.items.iter()).filter_map(|i| i.image_file.as_ref()));
    for name in files {
        if !written.insert(name.clone()) {
            continue;
        }
        let path = images_dir.join(name);
        let Ok(bytes) = std::fs::read(&path) else { continue };
        zip.start_file(format!("images/{name}"), img_opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(data.cars.len())
}

/// `replace = true` apaga tudo e restaura o backup.
/// `replace = false` mescla: carros com o mesmo id são atualizados, os novos são adicionados.
pub fn import(
    conn: &mut Connection,
    images_dir: &Path,
    src: &Path,
    replace: bool,
) -> Result<ImportResult, String> {
    let file = File::open(src).map_err(|e| format!("Não consegui abrir o arquivo: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "Esse arquivo não é um backup válido do Garimpalo (.zip).".to_string())?;

    let data: BackupData = {
        let mut entry = zip
            .by_name(DATA_FILE)
            .map_err(|_| "Backup inválido: falta o garimpalo.json.".to_string())?;
        let mut s = String::new();
        entry.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("Backup corrompido: {e}"))?
    };
    if data.format != "garimpalo-backup" {
        return Err("Esse arquivo não é um backup do Garimpalo.".into());
    }

    // 1) Extrai as imagens primeiro (nomes únicos por uuid, então não colidem)
    let mut images = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else { continue };
        let mut comps = rel.components();
        let (Some(first), Some(fname), None) = (comps.next(), comps.next(), comps.next()) else {
            continue;
        };
        if first.as_os_str() != "images" {
            continue;
        }
        let Some(fname) = fname.as_os_str().to_str().and_then(crate::photos::safe_file_name)
        else {
            continue;
        };
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(images_dir.join(fname), buf).map_err(|e| e.to_string())?;
        images += 1;
    }

    // 2) Dados numa transação só
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if replace {
        tx.execute("DELETE FROM cars", []).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sales", []).map_err(|e| e.to_string())?;
        if data.settings.is_object() {
            db::save_settings(&tx, &data.settings).map_err(|e| e.to_string())?;
        }
    }
    for car in &data.cars {
        let car = normalize_photos(car.clone());
        db::upsert_car(&tx, &car).map_err(|e| e.to_string())?;
    }
    for sale in &data.sales {
        let mut sale = sale.clone();
        for it in &mut sale.items {
            it.image_file = it.image_file.take().filter(|f| crate::photos::safe_file_name(f).is_some());
        }
        sales::insert(&tx, &sale).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(ImportResult { cars: data.cars.len(), images })
}

/// Backups da versão 1 têm só `imageFile`: vira a capa. Nomes inseguros são descartados.
fn normalize_photos(mut car: Car) -> Car {
    use crate::photos::{safe_file_name, Photo};
    if car.photos.is_empty() {
        if let Some(f) = car.image_file.take() {
            car.photos.push(Photo { file: f.clone(), original: f, edits: Default::default() });
        }
    }
    car.photos.retain(|p| safe_file_name(&p.file).is_some() && safe_file_name(&p.original).is_some());
    car.photos.truncate(db::MAX_PHOTOS);
    car
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("garimpalo-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(d.join("images")).unwrap();
        d
    }

    fn car(id: &str, name: &str, img: Option<&str>) -> Car {
        Car {
            id: id.into(),
            collection: "hotwheels".into(),
            name: name.into(),
            description: "teste".into(),
            quantity: 2,
            acquired_at: Some("2026-11-18".into()),
            acquisition_price: Some(1200),
            sale_price: Some(2900),
            promo_price: Some(2000),
            image_file: None,
            photos: img
                .map(|f| vec![crate::photos::Photo { file: f.into(), original: format!("o_{f}"), edits: Default::default() }])
                .unwrap_or_default(),
            created_at: "2026-11-18T10:00:00-03:00".into(),
            updated_at: "2026-11-18T10:00:00-03:00".into(),
        }
    }

    #[test]
    fn export_then_import_replace_and_merge() {
        // origem: 2 carros, 1 com foto
        let a = tmp_dir("a");
        let conn_a = db::open(&a.join("db")).unwrap();
        std::fs::write(a.join("images/foto.jpg"), b"jpegbytes").unwrap();
        std::fs::write(a.join("images/o_foto.jpg"), b"original").unwrap();
        db::upsert_car(&conn_a, &car("1", "Porsche 904", Some("foto.jpg"))).unwrap();
        db::upsert_car(&conn_a, &car("2", "La Liebre", None)).unwrap();
        db::save_settings(&conn_a, &serde_json::json!({"catalogTitle": "Garagem"})).unwrap();
        let zip_path = a.join("backup.zip");
        assert_eq!(export(&conn_a, &a.join("images"), &zip_path).unwrap(), 2);

        // destino já tem um carro diferente
        let b = tmp_dir("b");
        let mut conn_b = db::open(&b.join("db")).unwrap();
        db::upsert_car(&conn_b, &car("9", "Outro", None)).unwrap();

        // mesclar: mantém o "Outro" e adiciona os 2
        let r = import(&mut conn_b, &b.join("images"), &zip_path, false).unwrap();
        assert_eq!((r.cars, r.images), (2, 2));
        assert_eq!(db::list_cars(&conn_b, None).unwrap().len(), 3);
        assert_eq!(std::fs::read(b.join("images/foto.jpg")).unwrap(), b"jpegbytes");

        // substituir: fica igual à origem, inclusive configurações
        import(&mut conn_b, &b.join("images"), &zip_path, true).unwrap();
        let cars = db::list_cars(&conn_b, None).unwrap();
        assert_eq!(cars.len(), 2);
        let p = cars.iter().find(|c| c.id == "1").unwrap();
        assert_eq!((p.sale_price, p.promo_price, p.quantity), (Some(2900), Some(2000), 2));
        assert_eq!(db::get_settings(&conn_b).unwrap()["catalogTitle"], "Garagem");
        assert_eq!(p.photos.len(), 1);
        assert_eq!(p.image_file.as_deref(), Some("foto.jpg"));

        let _ = std::fs::remove_dir_all(a);
        let _ = std::fs::remove_dir_all(b);
    }

    #[test]
    fn imports_version_1_backup_with_single_image() {
        let d = tmp_dir("v1");
        let mut conn = db::open(&d.join("db")).unwrap();
        let p = d.join("v1.zip");
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        z.start_file(DATA_FILE, SimpleFileOptions::default()).unwrap();
        z.write_all(br#"{"format":"garimpalo-backup","version":1,"exportedAt":"x","settings":{},
            "cars":[{"id":"a","name":"Velho","quantity":1,"imageFile":"velha.jpg"}]}"#).unwrap();
        z.start_file("images/velha.jpg", SimpleFileOptions::default()).unwrap();
        z.write_all(b"jpg").unwrap();
        z.finish().unwrap();
        import(&mut conn, &d.join("images"), &p, true).unwrap();
        let car = db::get_car(&conn, "a").unwrap().unwrap();
        assert_eq!(car.photos.len(), 1);
        assert_eq!((car.photos[0].file.as_str(), car.photos[0].original.as_str()), ("velha.jpg", "velha.jpg"));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_non_backup_zip() {
        let d = tmp_dir("bad");
        let mut conn = db::open(&d.join("db")).unwrap();
        let p = d.join("x.zip");
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        z.start_file("qualquer.txt", SimpleFileOptions::default()).unwrap();
        z.write_all(b"oi").unwrap();
        z.finish().unwrap();
        assert!(import(&mut conn, &d.join("images"), &p, true).is_err());
        let _ = std::fs::remove_dir_all(d);
    }
}
