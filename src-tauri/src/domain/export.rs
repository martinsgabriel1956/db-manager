use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DocumentFormat {
    /// one Extended JSON document per line
    Ndjson,
    /// a JSON array of documents
    JsonArray,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub rows: u32,
    pub duration_ms: u32,
}
