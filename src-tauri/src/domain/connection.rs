use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Postgres,
    Mysql,
    Sqlite,
    Mongo,
    Redis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Local,
    Dev,
    Staging,
    Prod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TlsMode {
    Disable,
    Prefer,
    Require,
    VerifyFull,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TlsConfig {
    pub mode: TlsMode,
    pub ca_cert_path: Option<String>,
}

/// Where the database lives: a server (Postgres, MySQL, Mongo, Redis) or a file (SQLite).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    #[serde(rename_all = "camelCase")]
    Network {
        host: String,
        port: u16,
        database: String,
        username: String,
    },
    #[serde(rename_all = "camelCase")]
    File { path: String },
}

/// Connection metadata persisted in connections.json. The password never lives here:
/// it goes to the OS keychain under the connection id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub environment: Environment,
    pub read_only: bool,
    /// 0 disables the timeout
    pub timeout_secs: u32,
    pub target: Target,
    pub tls: TlsConfig,
    /// Redis only: separator used to group keys in the tree
    pub key_separator: Option<String>,
}

/// What to do with the stored password when saving a connection.
/// The front never receives the stored password, so editing needs an explicit "keep".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "action", content = "value", rename_all = "camelCase")]
pub enum SecretChange {
    Keep,
    Set(String),
    Clear,
}

/// Result of an operation that touches the keychain. Metadata is saved even when the
/// keychain fails, so the failure is reported as a warning instead of an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeychainOutcome {
    pub keychain_warning: Option<String>,
}
