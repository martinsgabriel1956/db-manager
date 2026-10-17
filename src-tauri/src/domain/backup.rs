use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::Confirmation;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum BackupFormat {
    /// Postgres `pg_dump --format=custom`: compressed, restored by `pg_restore`
    Custom,
    /// SQL text: `pg_dump --format=plain` or `mysqldump`, restored by `psql` / `mysql`
    Sql,
    /// SQLite: a consistent copy of the database file (`VACUUM INTO`)
    SqliteFile,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    /// what ran, as it could be typed in a terminal, without the password
    pub command: String,
    /// f64 because specta forbids u64; exact up to 2^53 bytes
    pub bytes: f64,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RestoreResponse {
    #[serde(rename_all = "camelCase")]
    Restored {
        command: String,
        duration_ms: u32,
    },
    NeedsConfirmation {
        confirmation: Confirmation,
    },
}
