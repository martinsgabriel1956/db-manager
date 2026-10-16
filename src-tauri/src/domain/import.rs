use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::Confirmation;

/// The start of a CSV file, to map its columns before importing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub columns: Vec<String>,
    /// the first rows; `None` is an empty unquoted field (NULL)
    pub rows: Vec<Vec<Option<String>>>,
    /// guessed from the header: `,`, `;` or a tab
    pub delimiter: String,
}

/// File column (by position) → table column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    pub source: u32,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvImport {
    pub schema: String,
    pub table: String,
    pub path: String,
    /// table columns left out keep their default
    pub mapping: Vec<ColumnMapping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImportResponse {
    /// always first: the sample INSERT and the row count, to confirm before anything runs
    NeedsConfirmation {
        confirmation: Confirmation,
    },
    Imported {
        rows: u32,
        duration_ms: u32,
    },
}
