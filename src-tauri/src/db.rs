//! Banco local (SQLite dentro da pasta de dados do app).

use crate::photos::{Edits, Photo};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// 1: só uma foto (cars.image_file). 2: até 3 fotos editáveis (tabela photos).
pub const SCHEMA_VERSION: i64 = 2;
pub const MAX_PHOTOS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Car {
    pub id: String,
    #[serde(default = "default_collection")]
    pub collection: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "one")]
    pub quantity: i64,
    /// Data da aquisição (AAAA-MM-DD)
    #[serde(default)]
    pub acquired_at: Option<String>,
    /// Valor pago por unidade, em centavos
    #[serde(default)]
    pub acquisition_price: Option<i64>,
    /// Preço de venda, em centavos
    #[serde(default)]
    pub sale_price: Option<i64>,
    /// Preço promocional ("por"), em centavos. Quando existe, o catálogo mostra "de/por".
    #[serde(default)]
    pub promo_price: Option<i64>,
    /// Capa (= primeira foto). Mantido por compatibilidade com backups antigos.
    #[serde(default)]
    pub image_file: Option<String>,
    /// Até 3 fotos; a primeira é a capa do catálogo.
    #[serde(default)]
    pub photos: Vec<Photo>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_collection() -> String {
    "hotwheels".into()
}
fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionStats {
    pub collection: String,
    pub models: i64,
    pub units: i64,
    pub invested: i64,
    pub for_sale_value: i64,
    pub cover_image: Option<String>,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    crate::sales::migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cars (
            id                TEXT PRIMARY KEY,
            collection        TEXT NOT NULL DEFAULT 'hotwheels',
            name              TEXT NOT NULL,
            description       TEXT NOT NULL DEFAULT '',
            quantity          INTEGER NOT NULL DEFAULT 1,
            acquired_at       TEXT,
            acquisition_price INTEGER,
            sale_price        INTEGER,
            promo_price       INTEGER,
            image_file        TEXT,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cars_collection ON cars(collection);
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS photos (
            car_id   TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            file     TEXT NOT NULL,
            original TEXT NOT NULL,
            edits    TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (car_id, position)
        );",
    )?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 2 {
        // A foto única antiga vira a capa (ela mesma serve de original).
        conn.execute(
            "INSERT OR IGNORE INTO photos (car_id, position, file, original, edits)
             SELECT id, 0, image_file, image_file, '{}' FROM cars WHERE image_file IS NOT NULL",
            [],
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn photos_by_car(conn: &Connection, car_id: Option<&str>) -> rusqlite::Result<HashMap<String, Vec<Photo>>> {
    let sql = "SELECT car_id, file, original, edits FROM photos
               WHERE (?1 IS NULL OR car_id = ?1) ORDER BY car_id, position";
    let mut st = conn.prepare(sql)?;
    let rows = st.query_map([car_id], |r| {
        let edits: String = r.get(3)?;
        Ok((
            r.get::<_, String>(0)?,
            Photo {
                file: r.get(1)?,
                original: r.get(2)?,
                edits: serde_json::from_str::<Edits>(&edits).unwrap_or_default(),
            },
        ))
    })?;
    let mut map: HashMap<String, Vec<Photo>> = HashMap::new();
    for row in rows {
        let (id, photo) = row?;
        map.entry(id).or_default().push(photo);
    }
    Ok(map)
}

fn attach_photos(cars: &mut [Car], mut map: HashMap<String, Vec<Photo>>) {
    for car in cars {
        car.photos = map.remove(&car.id).unwrap_or_default();
        car.image_file = car.photos.first().map(|p| p.file.clone());
    }
}

fn row_to_car(r: &Row) -> rusqlite::Result<Car> {
    Ok(Car {
        id: r.get("id")?,
        collection: r.get("collection")?,
        name: r.get("name")?,
        description: r.get("description")?,
        quantity: r.get("quantity")?,
        acquired_at: r.get("acquired_at")?,
        acquisition_price: r.get("acquisition_price")?,
        sale_price: r.get("sale_price")?,
        promo_price: r.get("promo_price")?,
        image_file: r.get("image_file")?,
        photos: Vec::new(),
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

pub fn list_cars(conn: &Connection, collection: Option<&str>) -> rusqlite::Result<Vec<Car>> {
    let mut out = Vec::new();
    match collection {
        Some(c) => {
            let mut st = conn.prepare(
                "SELECT * FROM cars WHERE collection = ?1 ORDER BY created_at DESC",
            )?;
            for car in st.query_map([c], row_to_car)? {
                out.push(car?);
            }
        }
        None => {
            let mut st = conn.prepare("SELECT * FROM cars ORDER BY created_at DESC")?;
            for car in st.query_map([], row_to_car)? {
                out.push(car?);
            }
        }
    }
    attach_photos(&mut out, photos_by_car(conn, None)?);
    Ok(out)
}

pub fn get_car(conn: &Connection, id: &str) -> rusqlite::Result<Option<Car>> {
    let Some(car) = conn.query_row("SELECT * FROM cars WHERE id = ?1", [id], row_to_car).optional()? else {
        return Ok(None);
    };
    let mut cars = [car];
    attach_photos(&mut cars, photos_by_car(conn, Some(id))?);
    let [car] = cars;
    Ok(Some(car))
}

/// Insere ou substitui um carro inteiro, com as fotos (mantém o id).
/// Use dentro de uma transação para gravar carro e fotos juntos.
pub fn upsert_car(conn: &Connection, c: &Car) -> rusqlite::Result<()> {
    let cover = c.photos.first().map(|p| p.file.clone());
    conn.execute(
        "INSERT INTO cars (id, collection, name, description, quantity, acquired_at,
                           acquisition_price, sale_price, promo_price, image_file,
                           created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            collection = excluded.collection,
            name = excluded.name,
            description = excluded.description,
            quantity = excluded.quantity,
            acquired_at = excluded.acquired_at,
            acquisition_price = excluded.acquisition_price,
            sale_price = excluded.sale_price,
            promo_price = excluded.promo_price,
            image_file = excluded.image_file,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at",
        params![
            c.id,
            c.collection,
            c.name,
            c.description,
            c.quantity,
            c.acquired_at,
            c.acquisition_price,
            c.sale_price,
            c.promo_price,
            cover,
            c.created_at,
            c.updated_at
        ],
    )?;
    conn.execute("DELETE FROM photos WHERE car_id = ?1", [&c.id])?;
    for (i, p) in c.photos.iter().take(MAX_PHOTOS).enumerate() {
        conn.execute(
            "INSERT INTO photos (car_id, position, file, original, edits) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![c.id, i as i64, p.file, p.original, serde_json::to_string(&p.edits).unwrap_or_default()],
        )?;
    }
    Ok(())
}

pub fn delete_car(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM cars WHERE id = ?1", [id])?;
    Ok(())
}

/// Todos os arquivos de imagem em uso (fotos finais e originais, e as fotos guardadas nas vendas).
pub fn referenced_images(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut st = conn.prepare(
        "SELECT file FROM photos UNION SELECT original FROM photos
         UNION SELECT image_file FROM sale_items WHERE image_file IS NOT NULL",
    )?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

pub fn stats(conn: &Connection) -> rusqlite::Result<Vec<CollectionStats>> {
    let mut st = conn.prepare(
        "SELECT collection,
                COUNT(*),
                COALESCE(SUM(quantity), 0),
                COALESCE(SUM(COALESCE(acquisition_price, 0) * quantity), 0),
                COALESCE(SUM(COALESCE(promo_price, sale_price, 0) * quantity), 0),
                (SELECT image_file FROM cars c2
                  WHERE c2.collection = cars.collection AND c2.image_file IS NOT NULL
                  ORDER BY c2.created_at DESC LIMIT 1)
         FROM cars GROUP BY collection",
    )?;
    let rows = st.query_map([], |r| {
        Ok(CollectionStats {
            collection: r.get(0)?,
            models: r.get(1)?,
            units: r.get(2)?,
            invested: r.get(3)?,
            for_sale_value: r.get(4)?,
            cover_image: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn get_settings(conn: &Connection) -> rusqlite::Result<serde_json::Value> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get(0))
        .optional()?;
    Ok(raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({})))
}

pub fn save_settings(conn: &Connection, value: &serde_json::Value) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value.to_string()],
    )?;
    Ok(())
}
