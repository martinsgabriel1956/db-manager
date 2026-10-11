//! Staged grid edits → SQL. Rows are identified by their full primary key, values are
//! untyped literals that PostgreSQL coerces to the column type (same as typing them
//! in psql), so every editable type round-trips through its text form.

use crate::adapters::postgres::browse::{quote_ident, quote_literal};
use crate::domain::{AppError, Cell, ColumnValue, KeyValue, RowChange};

pub fn change_sql(schema: &str, table: &str, change: &RowChange) -> Result<String, AppError> {
    let target = format!("{}.{}", quote_ident(schema), quote_ident(table));
    match change {
        RowChange::Update { key, values } => {
            if values.is_empty() {
                return Err(AppError::validation("alteração sem colunas"));
            }
            let assignments = values
                .iter()
                .map(|v| {
                    Ok(format!(
                        "{} = {}",
                        quote_ident(&v.column),
                        value_literal(v)?
                    ))
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(format!(
                "UPDATE {target} SET {} WHERE {}",
                assignments.join(", "),
                key_condition(key)?
            ))
        }
        RowChange::Insert { values } if values.is_empty() => {
            Ok(format!("INSERT INTO {target} DEFAULT VALUES"))
        }
        RowChange::Insert { values } => {
            let columns: Vec<String> = values.iter().map(|v| quote_ident(&v.column)).collect();
            let literals = values
                .iter()
                .map(value_literal)
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(format!(
                "INSERT INTO {target} ({}) VALUES ({})",
                columns.join(", "),
                literals.join(", ")
            ))
        }
        RowChange::Delete { key } => Ok(format!(
            "DELETE FROM {target} WHERE {}",
            key_condition(key)?
        )),
    }
}

fn value_literal(value: &ColumnValue) -> Result<String, AppError> {
    match &value.value {
        Some(text) => quote_literal(text),
        None => Ok("NULL".to_string()),
    }
}

fn key_condition(key: &[KeyValue]) -> Result<String, AppError> {
    if key.is_empty() {
        return Err(AppError::validation("linha sem chave primária"));
    }
    let conditions = key
        .iter()
        .map(|k| {
            Ok(format!(
                "{} = {}",
                quote_ident(&k.column),
                key_literal(&k.value)?
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(conditions.join(" AND "))
}

/// The exact text PostgreSQL rendered for the key, quoted back.
fn key_literal(cell: &Cell) -> Result<String, AppError> {
    let text = match cell {
        Cell::Bool(value) => value.to_string(),
        // Rust prints the shortest text that round-trips, same as PostgreSQL 12+
        Cell::Float(value) => value.to_string(),
        Cell::Int(text)
        | Cell::Decimal(text)
        | Cell::Text(text)
        | Cell::Date(text)
        | Cell::Json(text) => text.clone(),
        Cell::Timestamp { value, .. } => value.clone(),
        Cell::Null => return Err(AppError::validation("chave primária nula")),
        Cell::Bytes { .. } | Cell::Array(_) | Cell::Unknown { .. } => {
            return Err(AppError::validation(
                "chave primária de um tipo que não pode ser editado",
            ));
        }
    };
    quote_literal(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(column: &str, value: Cell) -> KeyValue {
        KeyValue {
            column: column.into(),
            value,
        }
    }

    fn value(column: &str, value: Option<&str>) -> ColumnValue {
        ColumnValue {
            column: column.into(),
            value: value.map(str::to_string),
        }
    }

    #[test]
    fn builds_update_insert_and_delete() {
        let update = RowChange::Update {
            key: vec![
                key("id", Cell::Int("7".into())),
                key("tenant", Cell::Text("a'b".into())),
            ],
            values: vec![value("name", Some("O'Brien")), value("note", None)],
        };
        let insert = RowChange::Insert {
            values: vec![value("name", Some(r"c:\temp")), value("age", None)],
        };
        let delete = RowChange::Delete {
            key: vec![key("id", Cell::Int("9".into()))],
        };

        assert_eq!(
            change_sql("app", "users", &update).unwrap(),
            r#"UPDATE "app"."users" SET "name" = 'O''Brien', "note" = NULL WHERE "id" = '7' AND "tenant" = 'a''b'"#
        );
        assert_eq!(
            change_sql("app", "users", &insert).unwrap(),
            r#"INSERT INTO "app"."users" ("name", "age") VALUES (E'c:\\temp', NULL)"#
        );
        assert_eq!(
            change_sql("app", "users", &RowChange::Insert { values: vec![] }).unwrap(),
            r#"INSERT INTO "app"."users" DEFAULT VALUES"#
        );
        assert_eq!(
            change_sql("app", "users", &delete).unwrap(),
            r#"DELETE FROM "app"."users" WHERE "id" = '9'"#
        );
    }

    #[test]
    fn key_literals_use_the_rendered_text() {
        let cases = [
            (Cell::Bool(true), "'true'"),
            (Cell::Float(0.1), "'0.1'"),
            (Cell::Decimal("1.50".into()), "'1.50'"),
            (Cell::Date("2024-02-29".into()), "'2024-02-29'"),
            (
                Cell::Timestamp {
                    value: "2024-01-01 13:00:00+00".into(),
                    tz: Some("UTC".into()),
                },
                "'2024-01-01 13:00:00+00'",
            ),
            (Cell::Json(r#"{"a": 1}"#.into()), r#"'{"a": 1}'"#),
        ];
        for (cell, expected) in cases {
            assert_eq!(key_literal(&cell).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_unusable_changes() {
        let no_key = RowChange::Delete { key: vec![] };
        let null_key = RowChange::Delete {
            key: vec![key("id", Cell::Null)],
        };
        let bytes_key = RowChange::Delete {
            key: vec![key(
                "id",
                Cell::Bytes {
                    len: 1,
                    preview_hex: "00".into(),
                },
            )],
        };
        let empty_update = RowChange::Update {
            key: vec![key("id", Cell::Int("1".into()))],
            values: vec![],
        };

        for change in [no_key, null_key, bytes_key, empty_update] {
            assert!(matches!(
                change_sql("s", "t", &change),
                Err(AppError::Validation(_))
            ));
        }
    }
}
