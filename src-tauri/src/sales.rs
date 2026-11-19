//! Vendas: quem comprou, contato, os itens com o valor combinado, o total cobrado e uma observação.
//! Cada item guarda nome e foto do carrinho no momento da venda (o histórico não muda se o cadastro mudar).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleItem {
    #[serde(default)]
    pub car_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub image_file: Option<String>,
    pub quantity: i64,
    /// valor combinado por unidade, em centavos
    pub unit_price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sale {
    pub id: String,
    #[serde(default)]
    pub buyer: String,
    #[serde(default)]
    pub contact: String,
    #[serde(default)]
    pub notes: String,
    /// total cobrado, em centavos (pode ter ajuste em relação à soma dos itens)
    pub total: i64,
    pub items: Vec<SaleItem>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleItemInput {
    pub car_id: String,
    pub quantity: i64,
    pub unit_price: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleInput {
    #[serde(default)]
    pub buyer: String,
    #[serde(default)]
    pub contact: String,
    #[serde(default)]
    pub notes: String,
    /// total combinado; sem ele, é a soma dos itens
    #[serde(default)]
    pub total: Option<i64>,
    pub items: Vec<SaleItemInput>,
    /// tira as unidades vendidas do estoque
    #[serde(default)]
    pub update_stock: bool,
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sales (
            id         TEXT PRIMARY KEY,
            buyer      TEXT NOT NULL DEFAULT '',
            contact    TEXT NOT NULL DEFAULT '',
            notes      TEXT NOT NULL DEFAULT '',
            total      INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sale_items (
            sale_id    TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            position   INTEGER NOT NULL,
            car_id     TEXT,
            name       TEXT NOT NULL,
            image_file TEXT,
            quantity   INTEGER NOT NULL,
            unit_price INTEGER NOT NULL,
            PRIMARY KEY (sale_id, position)
        );",
    )
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn create(conn: &mut Connection, input: SaleInput) -> Result<Sale, String> {
    if input.items.is_empty() {
        return Err("A venda precisa de pelo menos um modelo.".into());
    }
    if input.items.iter().any(|i| i.quantity < 1 || i.unit_price < 0) {
        return Err("Confira as quantidades e os valores da venda.".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut items = Vec::with_capacity(input.items.len());
    for it in &input.items {
        let (name, image_file): (String, Option<String>) = tx
            .query_row("SELECT name, image_file FROM cars WHERE id = ?1", [&it.car_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "Um dos modelos da venda não existe mais.".to_string())?;
        items.push(SaleItem {
            car_id: Some(it.car_id.clone()),
            name,
            image_file,
            quantity: it.quantity,
            unit_price: it.unit_price,
        });
        if input.update_stock {
            tx.execute(
                "UPDATE cars SET quantity = MAX(quantity - ?1, 0), updated_at = ?2 WHERE id = ?3",
                params![it.quantity, now(), it.car_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let sum: i64 = items.iter().map(|i| i.quantity * i.unit_price).sum();
    let sale = Sale {
        id: uuid::Uuid::new_v4().to_string(),
        buyer: input.buyer.trim().to_string(),
        contact: input.contact.trim().to_string(),
        notes: input.notes.trim().to_string(),
        total: input.total.filter(|t| *t >= 0).unwrap_or(sum),
        items,
        created_at: now(),
    };
    insert(&tx, &sale).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(sale)
}

/// Grava (ou substitui) uma venda inteira — usado ao criar e ao importar backup.
pub fn insert(conn: &Connection, s: &Sale) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sales WHERE id = ?1", [&s.id])?;
    conn.execute(
        "INSERT INTO sales (id, buyer, contact, notes, total, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![s.id, s.buyer, s.contact, s.notes, s.total, s.created_at],
    )?;
    for (pos, it) in s.items.iter().enumerate() {
        conn.execute(
            "INSERT INTO sale_items (sale_id, position, car_id, name, image_file, quantity, unit_price)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![s.id, pos as i64, it.car_id, it.name, it.image_file, it.quantity, it.unit_price],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Sale>> {
    let mut st = conn.prepare("SELECT id, buyer, contact, notes, total, created_at FROM sales ORDER BY created_at DESC")?;
    let mut sales = st
        .query_map([], |r| {
            Ok(Sale {
                id: r.get(0)?,
                buyer: r.get(1)?,
                contact: r.get(2)?,
                notes: r.get(3)?,
                total: r.get(4)?,
                created_at: r.get(5)?,
                items: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut it = conn.prepare(
        "SELECT car_id, name, image_file, quantity, unit_price FROM sale_items WHERE sale_id = ?1 ORDER BY position",
    )?;
    for s in &mut sales {
        s.items = it
            .query_map([&s.id], |r| {
                Ok(SaleItem {
                    car_id: r.get(0)?,
                    name: r.get(1)?,
                    image_file: r.get(2)?,
                    quantity: r.get(3)?,
                    unit_price: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }
    Ok(sales)
}

/// Apaga a venda. Com `restock`, devolve as unidades ao estoque dos modelos que ainda existem.
pub fn delete(conn: &mut Connection, id: &str, restock: bool) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    if restock {
        tx.execute(
            "UPDATE cars SET quantity = quantity + (
                 SELECT COALESCE(SUM(quantity), 0) FROM sale_items WHERE sale_id = ?1 AND car_id = cars.id
             ), updated_at = ?2
             WHERE id IN (SELECT car_id FROM sale_items WHERE sale_id = ?1)",
            params![id, now()],
        )?;
    }
    tx.execute("DELETE FROM sales WHERE id = ?1", [id])?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn sale_lowers_stock_and_undo_restores_it() {
        let dir = std::env::temp_dir().join(format!("garimpalo-sales-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = db::open(&dir.join("db")).unwrap();
        conn.execute(
            "INSERT INTO cars (id, name, quantity, sale_price, image_file, created_at, updated_at)
             VALUES ('a', 'Skyline', 3, 6500, 'sky.jpg', 'x', 'x')",
            [],
        )
        .unwrap();
        let sale = create(
            &mut conn,
            SaleInput {
                buyer: " João ".into(),
                contact: "11 9999".into(),
                notes: "retira sábado".into(),
                total: None,
                items: vec![SaleItemInput { car_id: "a".into(), quantity: 2, unit_price: 6000 }],
                update_stock: true,
            },
        )
        .unwrap();
        assert_eq!((sale.total, sale.buyer.as_str()), (12000, "João"));
        let qty: i64 = conn.query_row("SELECT quantity FROM cars WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(qty, 1);
        let all = list(&conn).unwrap();
        assert_eq!(all[0].items[0].name, "Skyline");
        assert!(db::referenced_images(&conn).unwrap().contains(&"sky.jpg".to_string()));

        delete(&mut conn, &sale.id, true).unwrap();
        let qty: i64 = conn.query_row("SELECT quantity FROM cars WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(qty, 3);
        assert!(list(&conn).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
