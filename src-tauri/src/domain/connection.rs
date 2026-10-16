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

/// Where the database lives: a server (Postgres, MySQL, Mongo, Redis), a file (SQLite),
/// a connection string (MongoDB) or a Redis Cluster.
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
    /// MongoDB connection string (mongodb:// or mongodb+srv://). The string itself
    /// carries credentials, so it is the secret kept in the keychain; only the
    /// database to open by default is stored here.
    #[serde(rename_all = "camelCase")]
    Uri { database: String },
    /// Redis Cluster: the seed nodes; the client discovers the rest from them.
    /// A cluster only has database 0.
    #[serde(rename_all = "camelCase")]
    RedisCluster {
        nodes: Vec<NodeAddress>,
        username: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NodeAddress {
    pub host: String,
    pub port: u16,
}

/// SSH tunnel to reach a network target through a bastion. Runs the system `ssh`,
/// so `~/.ssh/config`, the agent and `known_hosts` apply; empty fields leave it to them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    /// host name or a `Host` alias from `~/.ssh/config`
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
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
    /// absent in files saved before the tunnel existed
    #[serde(default)]
    pub ssh: Option<SshConfig>,
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
