//! MySQL text-protocol values → `Cell`, classified by column type name.

use crate::domain::Cell;

const PREVIEW_BYTES: usize = 32;

/// The session runs with `time_zone='+00:00'` (see `MysqlAdapter::connect`).
pub const SESSION_TIME_ZONE: &str = "UTC";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Int,
    Float,
    Decimal,
    Date,
    Datetime,
    Timestamp,
    Json,
    Text,
    Bytes,
    Unknown,
}

/// From sqlx's MySQL type name (e.g. "BIGINT UNSIGNED", "VARCHAR", "LONGBLOB").
pub fn kind(type_name: &str) -> Kind {
    let base = type_name.split(' ').next().unwrap_or_default();
    match base {
        // BOOLEAN is TINYINT(1): kept as the number it is, writes take 0/1
        "BOOLEAN" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" | "YEAR" => Kind::Int,
        "FLOAT" | "DOUBLE" => Kind::Float,
        "DECIMAL" => Kind::Decimal,
        "DATE" => Kind::Date,
        "DATETIME" => Kind::Datetime,
        "TIMESTAMP" => Kind::Timestamp,
        "JSON" => Kind::Json,
        "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET"
        | "TIME" => Kind::Text,
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT" => {
            Kind::Bytes
        }
        _ => Kind::Unknown,
    }
}

pub fn is_editable(kind: Kind) -> bool {
    !matches!(kind, Kind::Bytes | Kind::Unknown)
}

pub fn to_cell(kind: Kind, type_name: &str, raw: Option<&[u8]>) -> Cell {
    let Some(raw) = raw else {
        return Cell::Null;
    };
    if kind == Kind::Bytes {
        return Cell::Bytes {
            len: u32::try_from(raw.len()).unwrap_or(u32::MAX),
            preview_hex: raw
                .iter()
                .take(PREVIEW_BYTES)
                .map(|b| format!("{b:02x}"))
                .collect(),
        };
    }
    let text = String::from_utf8_lossy(raw).into_owned();
    let unknown = |text: String| Cell::Unknown {
        type_name: type_name.to_lowercase(),
        text,
    };
    match kind {
        Kind::Int => Cell::Int(text),
        Kind::Float => match text.parse::<f64>() {
            Ok(value) if value.is_finite() => Cell::Float(value),
            _ => unknown(text),
        },
        Kind::Decimal => Cell::Decimal(text),
        Kind::Date => Cell::Date(text),
        Kind::Datetime => Cell::Timestamp {
            value: text,
            tz: None,
        },
        Kind::Timestamp => Cell::Timestamp {
            value: text,
            tz: Some(SESSION_TIME_ZONE.to_string()),
        },
        Kind::Json if serde_json::from_str::<serde::de::IgnoredAny>(&text).is_ok() => {
            Cell::Json(text)
        }
        Kind::Text => Cell::Text(text),
        Kind::Json | Kind::Bytes | Kind::Unknown => unknown(text),
    }
}

/// Values a column accepts, from information_schema's COLUMN_TYPE:
/// `tinyint(1)` (BOOLEAN) takes 1/0, `enum('a','it''s')` its labels.
pub fn options(column_type: &str) -> Vec<String> {
    if column_type.eq_ignore_ascii_case("tinyint(1)") {
        return vec!["1".into(), "0".into()];
    }
    let Some(list) = column_type
        .strip_prefix("enum(")
        .and_then(|rest| rest.strip_suffix(')'))
    else {
        return Vec::new();
    };
    let mut labels = Vec::new();
    let mut chars = list.chars().peekable();
    while chars.next() == Some('\'') {
        let mut label = String::new();
        while let Some(c) = chars.next() {
            if c == '\'' {
                // '' is a quote inside the label
                if chars.peek() == Some(&'\'') {
                    chars.next();
                } else {
                    break;
                }
            }
            label.push(c);
        }
        labels.push(label);
        chars.next(); // the comma
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_from_column_type() {
        assert_eq!(options("tinyint(1)"), ["1", "0"]);
        assert_eq!(options("enum('a','it''s','x,y')"), ["a", "it's", "x,y"]);
        assert!(options("varchar(20)").is_empty());
        assert!(options("tinyint(4)").is_empty());
    }

    #[test]
    fn classifies_type_names() {
        let cases = [
            ("BIGINT UNSIGNED", Kind::Int),
            ("BOOLEAN", Kind::Int),
            ("DOUBLE", Kind::Float),
            ("DECIMAL", Kind::Decimal),
            ("TIMESTAMP", Kind::Timestamp),
            ("DATETIME", Kind::Datetime),
            ("JSON", Kind::Json),
            ("ENUM", Kind::Text),
            ("LONGTEXT", Kind::Text),
            ("VARBINARY", Kind::Bytes),
            ("GEOMETRY", Kind::Unknown),
        ];
        for (name, expected) in cases {
            assert_eq!(kind(name), expected, "{name}");
        }
        assert!(is_editable(Kind::Text));
        assert!(!is_editable(Kind::Bytes));
        assert!(!is_editable(Kind::Unknown));
    }

    #[test]
    fn converts_values() {
        let cases = [
            (
                Kind::Int,
                Some(&b"18446744073709551615"[..]),
                Cell::Int("18446744073709551615".into()),
            ),
            (Kind::Float, Some(b"1.5"), Cell::Float(1.5)),
            (
                Kind::Decimal,
                Some(b"0.1000"),
                Cell::Decimal("0.1000".into()),
            ),
            (
                Kind::Timestamp,
                Some(b"2024-01-01 13:00:00"),
                Cell::Timestamp {
                    value: "2024-01-01 13:00:00".into(),
                    tz: Some("UTC".into()),
                },
            ),
            (
                Kind::Json,
                Some(br#"{"id": 9007199254740993}"#),
                Cell::Json(r#"{"id": 9007199254740993}"#.into()),
            ),
            (
                Kind::Json,
                Some(b"{broken"),
                Cell::Unknown {
                    type_name: "t".into(),
                    text: "{broken".into(),
                },
            ),
            (
                Kind::Bytes,
                Some(&[0x00, 0xff][..]),
                Cell::Bytes {
                    len: 2,
                    preview_hex: "00ff".into(),
                },
            ),
            (Kind::Text, None, Cell::Null),
        ];
        for (kind, raw, expected) in cases {
            assert_eq!(to_cell(kind, "T", raw), expected, "{kind:?}");
        }
    }
}
