//! PostgreSQL text-format values → `Cell`. All queries run with the text protocol,
//! so the server renders every value exactly (numeric, int8, timestamps, arrays…)
//! and we only classify it by type OID.

use sqlx::TypeInfo;
use sqlx::postgres::{PgTypeInfo, PgTypeKind};

use crate::domain::Cell;

const PREVIEW_BYTES: usize = 32;

// Built-in type OIDs (stable, from pg_type.dat)
const BOOL: u32 = 16;
const BYTEA: u32 = 17;
const INT8: u32 = 20;
const INT2: u32 = 21;
const INT4: u32 = 23;
const OID: u32 = 26;
const JSON: u32 = 114;
const FLOAT4: u32 = 700;
const FLOAT8: u32 = 701;
const DATE: u32 = 1082;
const TIMESTAMP: u32 = 1114;
const TIMESTAMPTZ: u32 = 1184;
const NUMERIC: u32 = 1700;
const JSONB: u32 = 3802;
/// textual types we render as plain text (char, name, text, bpchar, varchar, uuid, xml,
/// time, timetz, interval, inet, cidr, macaddr, macaddr8, bit, varbit, money, unknown)
const TEXTUAL: &[u32] = &[
    18, 19, 25, 1042, 1043, 2950, 142, 1083, 1266, 1186, 869, 650, 829, 774, 1560, 1562, 790, 705,
];

/// The session runs with `TimeZone=UTC` (see `PostgresAdapter::connect`).
pub const SESSION_TIME_ZONE: &str = "UTC";

pub fn to_cell(type_info: &PgTypeInfo, text: Option<&str>) -> Cell {
    let Some(text) = text else {
        return Cell::Null;
    };
    if let PgTypeKind::Array(element) = type_info.kind() {
        return match parse_array(text) {
            Some(node) => array_to_cell(node, element),
            None => unknown(type_info, text),
        };
    }
    match type_info.oid().map(|oid| oid.0) {
        Some(oid) => scalar_to_cell(oid, text).unwrap_or_else(|| unknown(type_info, text)),
        None => unknown(type_info, text),
    }
}

pub fn type_name(type_info: &PgTypeInfo) -> String {
    match type_info.name() {
        // sqlx shows "?" for types it did not resolve (custom types, extensions)
        "?" => type_info
            .oid()
            .map_or_else(|| "?".to_string(), |oid| format!("oid:{}", oid.0)),
        name => name.to_lowercase(),
    }
}

fn unknown(type_info: &PgTypeInfo, text: &str) -> Cell {
    Cell::Unknown {
        type_name: type_name(type_info),
        text: text.to_string(),
    }
}

/// None = type we don't model (caller falls back to `Unknown`).
fn scalar_to_cell(oid: u32, text: &str) -> Option<Cell> {
    let cell = match oid {
        BOOL => Cell::Bool(text == "t"),
        INT2 | INT4 | INT8 | OID => Cell::Int(text.to_string()),
        FLOAT4 | FLOAT8 => {
            let value: f64 = text.parse().ok()?;
            if !value.is_finite() {
                return None;
            }
            Cell::Float(value)
        }
        NUMERIC => Cell::Decimal(text.to_string()),
        DATE => Cell::Date(text.to_string()),
        TIMESTAMP => Cell::Timestamp {
            value: text.to_string(),
            tz: None,
        },
        TIMESTAMPTZ => Cell::Timestamp {
            value: text.to_string(),
            tz: Some(SESSION_TIME_ZONE.to_string()),
        },
        JSON | JSONB => {
            serde_json::from_str::<serde::de::IgnoredAny>(text).ok()?;
            Cell::Json(text.to_string())
        }
        BYTEA => bytea_to_cell(text)?,
        oid if TEXTUAL.contains(&oid) => Cell::Text(text.to_string()),
        _ => return None,
    };
    Some(cell)
}

/// bytea_output=hex renders `\x0123ab`.
fn bytea_to_cell(text: &str) -> Option<Cell> {
    let hex = text.strip_prefix("\\x")?;
    let len = u32::try_from(hex.len() / 2).unwrap_or(u32::MAX);
    let preview_hex = hex.chars().take(PREVIEW_BYTES * 2).collect();
    Some(Cell::Bytes { len, preview_hex })
}

#[derive(Debug, PartialEq)]
enum ArrayNode {
    List(Vec<ArrayNode>),
    Item(Option<String>),
}

fn array_to_cell(node: ArrayNode, element: &PgTypeInfo) -> Cell {
    match node {
        ArrayNode::List(items) => Cell::Array(
            items
                .into_iter()
                .map(|item| array_to_cell(item, element))
                .collect(),
        ),
        ArrayNode::Item(value) => to_cell(element, value.as_deref()),
    }
}

/// Parses `{1,2,NULL}`, `{"a,b","c\"d"}`, `{{1,2},{3,4}}` and `[0:1]={1,2}`.
fn parse_array(text: &str) -> Option<ArrayNode> {
    let body = if text.starts_with('[') {
        &text[text.find('=')? + 1..]
    } else {
        text
    };
    let chars: Vec<char> = body.chars().collect();
    let mut pos = 0;
    let node = parse_list(&chars, &mut pos)?;
    (pos == chars.len()).then_some(node)
}

fn parse_list(chars: &[char], pos: &mut usize) -> Option<ArrayNode> {
    if chars.get(*pos) != Some(&'{') {
        return None;
    }
    *pos += 1;
    let mut items = Vec::new();
    if chars.get(*pos) == Some(&'}') {
        *pos += 1;
        return Some(ArrayNode::List(items));
    }
    loop {
        let item = match chars.get(*pos)? {
            '{' => parse_list(chars, pos)?,
            '"' => ArrayNode::Item(Some(parse_quoted(chars, pos)?)),
            _ => parse_unquoted(chars, pos),
        };
        items.push(item);
        match chars.get(*pos)? {
            ',' => *pos += 1,
            '}' => {
                *pos += 1;
                return Some(ArrayNode::List(items));
            }
            _ => return None,
        }
    }
}

fn parse_quoted(chars: &[char], pos: &mut usize) -> Option<String> {
    *pos += 1;
    let mut value = String::new();
    loop {
        match chars.get(*pos)? {
            '\\' => {
                value.push(*chars.get(*pos + 1)?);
                *pos += 2;
            }
            '"' => {
                *pos += 1;
                return Some(value);
            }
            c => {
                value.push(*c);
                *pos += 1;
            }
        }
    }
}

fn parse_unquoted(chars: &[char], pos: &mut usize) -> ArrayNode {
    let start = *pos;
    while chars.get(*pos).is_some_and(|c| *c != ',' && *c != '}') {
        *pos += 1;
    }
    let raw: String = chars[start..*pos].iter().collect();
    let raw = raw.trim();
    if raw.eq_ignore_ascii_case("NULL") {
        ArrayNode::Item(None)
    } else {
        ArrayNode::Item(Some(raw.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(value: &str) -> ArrayNode {
        ArrayNode::Item(Some(value.to_string()))
    }

    #[test]
    fn scalars_map_by_oid() {
        let cases = [
            (BOOL, "t", Cell::Bool(true)),
            (BOOL, "f", Cell::Bool(false)),
            (
                INT8,
                "9007199254740993",
                Cell::Int("9007199254740993".into()),
            ),
            (FLOAT8, "1.5", Cell::Float(1.5)),
            (
                NUMERIC,
                "12345678901234567890.0000000001",
                Cell::Decimal("12345678901234567890.0000000001".into()),
            ),
            (DATE, "2024-02-29", Cell::Date("2024-02-29".into())),
            (
                TIMESTAMP,
                "2024-01-01 10:00:00",
                Cell::Timestamp {
                    value: "2024-01-01 10:00:00".into(),
                    tz: None,
                },
            ),
            (
                TIMESTAMPTZ,
                "2024-01-01 10:00:00+00",
                Cell::Timestamp {
                    value: "2024-01-01 10:00:00+00".into(),
                    tz: Some("UTC".into()),
                },
            ),
            (
                JSONB,
                r#"{"id": 9007199254740993}"#,
                Cell::Json(r#"{"id": 9007199254740993}"#.into()),
            ),
            (
                BYTEA,
                "\\x00ff",
                Cell::Bytes {
                    len: 2,
                    preview_hex: "00ff".into(),
                },
            ),
            (
                2950,
                "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                Cell::Text("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11".into()),
            ),
        ];
        for (oid, text, expected) in cases {
            assert_eq!(
                scalar_to_cell(oid, text),
                Some(expected),
                "oid {oid} {text}"
            );
        }
    }

    #[test]
    fn unmodeled_or_unrepresentable_values_return_none() {
        assert_eq!(scalar_to_cell(FLOAT8, "NaN"), None);
        assert_eq!(scalar_to_cell(FLOAT8, "Infinity"), None);
        assert_eq!(scalar_to_cell(JSON, "{broken"), None);
        assert_eq!(scalar_to_cell(BYTEA, "not hex output"), None);
        assert_eq!(scalar_to_cell(600 /* point */, "(1,2)"), None);
    }

    #[test]
    fn bytea_preview_is_capped() {
        let hex = "ab".repeat(100);
        let Some(Cell::Bytes { len, preview_hex }) = bytea_to_cell(&format!("\\x{hex}")) else {
            panic!("expected bytes");
        };
        assert_eq!(len, 100);
        assert_eq!(preview_hex.len(), PREVIEW_BYTES * 2);
    }

    #[test]
    fn parses_array_literals() {
        use ArrayNode::{Item, List};
        let cases = [
            ("{}", List(vec![])),
            ("{1,2,NULL}", List(vec![item("1"), item("2"), Item(None)])),
            (
                r#"{"a,b","c\"d","NULL",null}"#,
                List(vec![item("a,b"), item("c\"d"), item("NULL"), Item(None)]),
            ),
            (
                "{{1,2},{3,4}}",
                List(vec![
                    List(vec![item("1"), item("2")]),
                    List(vec![item("3"), item("4")]),
                ]),
            ),
            ("[0:1]={7,8}", List(vec![item("7"), item("8")])),
            ("{ spaced , x }", List(vec![item("spaced"), item("x")])),
        ];
        for (text, expected) in cases {
            assert_eq!(parse_array(text), Some(expected), "{text}");
        }
    }

    #[test]
    fn rejects_malformed_arrays() {
        for text in ["", "1,2", "{1,2", "{\"open}", "{1}x", "{{1}x}"] {
            assert_eq!(parse_array(text), None, "{text}");
        }
    }

    #[test]
    fn null_is_null_regardless_of_type() {
        assert_eq!(to_cell(&PgTypeInfo::with_name("text"), None), Cell::Null);
    }
}
