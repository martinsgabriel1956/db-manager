//! CSV in the PostgreSQL `COPY … CSV` flavour: NULL is an empty unquoted field and
//! an empty string is `""`, so the two survive a round trip.

use std::io::{self, Write};

use crate::domain::Cell;

pub fn write_header(out: &mut impl Write, names: &[String]) -> io::Result<()> {
    let fields: Vec<String> = names.iter().map(|name| quote(name)).collect();
    writeln!(out, "{}", fields.join(","))
}

pub fn write_row(out: &mut impl Write, row: &[Cell]) -> io::Result<()> {
    let fields: Vec<String> = row
        .iter()
        .map(|cell| text(cell).map(|text| quote(&text)).unwrap_or_default())
        .collect();
    writeln!(out, "{}", fields.join(","))
}

fn quote(text: &str) -> String {
    if text.is_empty() || text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

/// The value as text; None for NULL.
fn text(cell: &Cell) -> Option<String> {
    Some(match cell {
        Cell::Null => return None,
        Cell::Bool(value) => value.to_string(),
        Cell::Float(value) => value.to_string(),
        Cell::Int(text)
        | Cell::Decimal(text)
        | Cell::Text(text)
        | Cell::Date(text)
        | Cell::Json(text)
        | Cell::Unknown { text, .. }
        // the text already carries the offset; `tz` only names the zone
        | Cell::Timestamp { value: text, .. } => text.clone(),
        // ponytail: the grid only carries a 32-byte preview; bigger blobs export as a
        // placeholder until cell conversion gets a "full bytes" mode
        Cell::Bytes { len, preview_hex } if preview_hex.len() == *len as usize * 2 => {
            format!("\\x{preview_hex}")
        }
        Cell::Bytes { len, .. } => format!("<{len} bytes>"),
        // ponytail: PostgreSQL-style {a,b} without quoting elements that contain commas
        Cell::Array(items) => {
            let items: Vec<String> = items
                .iter()
                .map(|item| text(item).unwrap_or_else(|| "NULL".to_string()))
                .collect();
            format!("{{{}}}", items.join(","))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(cells: &[Cell]) -> String {
        let mut out = Vec::new();
        write_row(&mut out, cells).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn null_and_empty_string_differ_and_specials_are_quoted() {
        assert_eq!(
            row(&[
                Cell::Null,
                Cell::Text(String::new()),
                Cell::Text("a,b".into()),
                Cell::Text("say \"hi\"\nbye".into()),
                Cell::Int("9007199254740993".into()),
                Cell::Bool(true),
            ]),
            ",\"\",\"a,b\",\"say \"\"hi\"\"\nbye\",9007199254740993,true\n"
        );
    }

    #[test]
    fn typed_values_keep_their_text() {
        assert_eq!(
            row(&[
                Cell::Timestamp {
                    value: "2026-01-02 03:04:05+00".into(),
                    tz: Some("UTC".into())
                },
                Cell::Bytes {
                    len: 2,
                    preview_hex: "00ff".into()
                },
                Cell::Bytes {
                    len: 100,
                    preview_hex: "00".repeat(32)
                },
                Cell::Array(vec![Cell::Int("1".into()), Cell::Null]),
                Cell::Float(1.5),
            ]),
            "2026-01-02 03:04:05+00,\\x00ff,<100 bytes>,\"{1,NULL}\",1.5\n"
        );
    }

    #[test]
    fn header_is_quoted_too() {
        let mut out = Vec::new();
        write_header(&mut out, &["id".into(), "full name".into(), "a,b".into()]).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "id,full name,\"a,b\"\n");
    }
}
