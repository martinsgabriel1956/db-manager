use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};

use crate::domain::{AppError, HistoryEntry};

/// Executed scripts and applied grid edits, in history.sqlite next to connections.json.
// ponytail: no retention limit; prune old rows if the file ever gets big
pub struct HistoryStore {
    pool: SqlitePool,
}

pub struct NewHistoryEntry<'a> {
    pub connection_id: &'a str,
    pub connection_name: &'a str,
    pub sql: &'a str,
    pub duration_ms: u32,
    pub error: Option<String>,
}

/// id, connection_id, connection_name, sql, executed_at, duration_ms, error
type HistoryRow = (i64, String, String, String, String, i64, Option<String>);

const SCHEMA: &str = r"
    CREATE TABLE IF NOT EXISTS history (
        id              INTEGER PRIMARY KEY,
        connection_id   TEXT NOT NULL,
        connection_name TEXT NOT NULL,
        sql             TEXT NOT NULL,
        executed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        duration_ms     INTEGER NOT NULL,
        error           TEXT
    )";

impl HistoryStore {
    pub async fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        Self::with_options(options).await
    }

    #[cfg(test)]
    pub async fn in_memory() -> Self {
        let options = "sqlite::memory:".parse::<SqliteConnectOptions>().unwrap();
        Self::with_options(options).await.unwrap()
    }

    async fn with_options(options: SqliteConnectOptions) -> Result<Self, AppError> {
        // one connection: writes are tiny, and an in-memory db lives per connection
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(AppError::storage)?;
        sqlx::query(SCHEMA)
            .execute(&pool)
            .await
            .map_err(AppError::storage)?;
        Ok(Self { pool })
    }

    pub async fn record(&self, entry: NewHistoryEntry<'_>) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO history (connection_id, connection_name, sql, duration_ms, error)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(entry.connection_id)
        .bind(entry.connection_name)
        .bind(entry.sql)
        .bind(entry.duration_ms)
        .bind(entry.error)
        .execute(&self.pool)
        .await
        .map_err(AppError::storage)?;
        Ok(())
    }

    /// Newest first; `text` matches anywhere in the SQL, case-insensitively.
    pub async fn search(
        &self,
        text: &str,
        connection_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<HistoryEntry>, AppError> {
        let pattern = format!("%{}%", escape_like(text));
        let rows: Vec<HistoryRow> = sqlx::query_as(
            r"SELECT id, connection_id, connection_name, sql, executed_at, duration_ms, error
                  FROM history
                  WHERE sql LIKE ? ESCAPE '\' AND (? IS NULL OR connection_id = ?)
                  ORDER BY id DESC
                  LIMIT ?",
        )
        .bind(pattern)
        .bind(connection_id)
        .bind(connection_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(AppError::storage)?;

        Ok(rows
            .into_iter()
            .map(
                |(id, connection_id, connection_name, sql, executed_at, duration_ms, error)| {
                    HistoryEntry {
                        id: u32::try_from(id).unwrap_or(u32::MAX),
                        connection_id,
                        connection_name,
                        sql,
                        executed_at,
                        duration_ms: u32::try_from(duration_ms).unwrap_or(u32::MAX),
                        success: error.is_none(),
                        error,
                    }
                },
            )
            .collect())
    }
}

fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry<'a>(connection_id: &'a str, sql: &'a str, error: Option<&str>) -> NewHistoryEntry<'a> {
        NewHistoryEntry {
            connection_id,
            connection_name: "pg",
            sql,
            duration_ms: 12,
            error: error.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn records_and_searches_newest_first() {
        let history = HistoryStore::in_memory().await;
        history
            .record(entry("a", "SELECT * FROM users", None))
            .await
            .unwrap();
        history
            .record(entry("a", "DELETE FROM orders WHERE id = 1", Some("boom")))
            .await
            .unwrap();
        history
            .record(entry("b", "select count(*) from users", None))
            .await
            .unwrap();

        let all = history.search("", None, 10).await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].sql, "select count(*) from users");
        assert!(all[0].executed_at.ends_with('Z'));

        let users = history.search("USERS", None, 10).await.unwrap();
        assert_eq!(users.len(), 2);

        let only_a = history.search("", Some("a"), 10).await.unwrap();
        assert_eq!(only_a.len(), 2);
        assert!(!only_a[0].success);
        assert_eq!(only_a[0].error.as_deref(), Some("boom"));

        assert_eq!(history.search("", None, 1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn like_wildcards_in_the_search_text_are_literal() {
        let history = HistoryStore::in_memory().await;
        history
            .record(entry("a", "SELECT 'a_b'", None))
            .await
            .unwrap();
        history
            .record(entry("a", "SELECT 'axb'", None))
            .await
            .unwrap();
        history
            .record(entry("a", "SELECT '100%'", None))
            .await
            .unwrap();

        assert_eq!(history.search("a_b", None, 10).await.unwrap().len(), 1);
        assert_eq!(history.search("100%", None, 10).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn open_creates_the_file_and_keeps_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/history.sqlite");

        HistoryStore::open(&path)
            .await
            .unwrap()
            .record(entry("a", "SELECT 1", None))
            .await
            .unwrap();
        let reopened = HistoryStore::open(&path).await.unwrap();

        assert_eq!(reopened.search("", None, 10).await.unwrap().len(), 1);
    }
}
