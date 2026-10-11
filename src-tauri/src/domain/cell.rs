use serde::{Deserialize, Serialize};
use specta::Type;

/// One value crossing the Rust ↔ TS boundary. JSON silently loses data (i64 > 2^53,
/// numeric precision, binary, NULL vs "NULL"), so every lossy type travels as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum Cell {
    Null,
    Bool(bool),
    /// any integer width, always as string
    Int(String),
    /// finite floats only; NaN/Infinity become `Unknown`
    Float(f64),
    /// numeric/decimal, exact text
    Decimal(String),
    Text(String),
    #[serde(rename_all = "camelCase")]
    Bytes {
        len: u32,
        preview_hex: String,
    },
    /// ISO 8601 date
    Date(String),
    /// `tz` is None for timestamps without time zone
    Timestamp {
        value: String,
        tz: Option<String>,
    },
    /// original JSON text, validated. Not a parsed value: JSON numbers beyond 2^53
    /// would be rounded by JavaScript on the way to the UI
    Json(String),
    Array(Vec<Cell>),
    /// type we don't model: shown as text, never editable
    #[serde(rename_all = "camelCase")]
    Unknown {
        type_name: String,
        text: String,
    },
}
