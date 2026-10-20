use serde::Serialize;
use specta::Type;

/// Serialized as `{ kind, message }`. The payload is the final, human-readable message
/// (built by the constructors below), so `message` and `Display` always match.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Keychain(String),
    #[error("{0}")]
    NotConnected(String),
    #[error("{0}")]
    Database(String),
    #[error("{0}")]
    Cancelled(String),
    #[error("{0}")]
    Timeout(String),
    /// an edited/deleted row no longer matches: nothing was saved
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    ReadOnly(String),
}

impl AppError {
    pub fn validation(message: impl Into<String>) -> Self {
        AppError::Validation(message.into())
    }

    pub fn not_found(what: &str) -> Self {
        AppError::NotFound(format!("não encontrado: {what}"))
    }

    pub fn storage(err: impl std::fmt::Display) -> Self {
        AppError::Storage(format!("falha ao ler/gravar dados locais: {err}"))
    }

    pub fn keychain(err: impl std::fmt::Display) -> Self {
        AppError::Keychain(format!("keychain indisponível: {err}"))
    }

    /// The id is for logs, never for the reader: it is a UUID.
    pub fn not_connected(_connection_id: &str) -> Self {
        AppError::NotConnected("a conexão não está aberta: abra-a de novo na lateral".to_string())
    }

    /// A result cursor closed under the view (the connection was closed, or the
    /// window hid and production was disconnected): the rows must be fetched again.
    pub fn result_closed() -> Self {
        AppError::NotFound("o resultado já foi fechado: execute a query de novo".to_string())
    }

    pub fn cancelled() -> Self {
        AppError::Cancelled("query cancelada".to_string())
    }

    pub fn conflict() -> Self {
        AppError::Conflict(
            "uma das linhas foi alterada ou removida por outra sessão; nada foi salvo".to_string(),
        )
    }

    pub fn read_only(connection_name: &str) -> Self {
        AppError::ReadOnly(format!("a conexão {connection_name} é somente leitura"))
    }

    /// The same error with its message rewritten: the kind (cancelled, timeout…) is
    /// what the UI reacts to, so context is added without changing it.
    pub fn map_message(self, f: impl FnOnce(String) -> String) -> Self {
        match self {
            AppError::Validation(m) => AppError::Validation(f(m)),
            AppError::NotFound(m) => AppError::NotFound(f(m)),
            AppError::Storage(m) => AppError::Storage(f(m)),
            AppError::Keychain(m) => AppError::Keychain(f(m)),
            AppError::NotConnected(m) => AppError::NotConnected(f(m)),
            AppError::Database(m) => AppError::Database(f(m)),
            AppError::Cancelled(m) => AppError::Cancelled(f(m)),
            AppError::Timeout(m) => AppError::Timeout(f(m)),
            AppError::Conflict(m) => AppError::Conflict(f(m)),
            AppError::ReadOnly(m) => AppError::ReadOnly(f(m)),
        }
    }

    pub fn timeout(secs: u32) -> Self {
        AppError::Timeout(format!(
            "query excedeu o timeout de {secs}s e foi cancelada"
        ))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::storage(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::storage(err)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db) = &err {
            // PostgreSQL 57014 (pg_cancel_backend), MySQL 70100 (KILL QUERY)
            if matches!(db.code().as_deref(), Some("57014" | "70100")) {
                return AppError::cancelled();
            }
            let code = db.code().map(|c| format!(" [{c}]")).unwrap_or_default();
            return AppError::Database(format!("{}{code}", db.message()));
        }
        AppError::Database(err.to_string())
    }
}
