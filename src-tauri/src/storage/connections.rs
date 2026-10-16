use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use crate::domain::{AppError, ConnectionConfig};

/// connections.json in the app data dir. Holds metadata only, never secrets.
pub struct ConnectionStore {
    path: PathBuf,
}

impl ConnectionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<Vec<ConnectionConfig>, AppError> {
        match fs::read_to_string(&self.path) {
            Ok(content) => Ok(serde_json::from_str(&content)?),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(err) => Err(err.into()),
        }
    }

    /// Writes to a temp file and renames it over the original, so a crash mid-write
    /// never leaves a truncated connections.json behind.
    pub fn save(&self, connections: &[ConnectionConfig]) -> Result<(), AppError> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(connections)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Engine, Environment, Target, TlsConfig, TlsMode};

    fn sqlite_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "a".into(),
            name: "local".into(),
            engine: Engine::Sqlite,
            environment: Environment::Local,
            read_only: false,
            timeout_secs: 30,
            target: Target::File {
                path: "/tmp/x.db".into(),
            },
            tls: TlsConfig {
                mode: TlsMode::Disable,
                ca_cert_path: None,
            },
            key_separator: None,
            ssh: None,
        }
    }

    #[test]
    fn load_returns_empty_when_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(dir.path().join("connections.json"));
        assert_eq!(store.load().unwrap(), Vec::new());
    }

    #[test]
    fn save_then_load_roundtrips_and_creates_parent_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/connections.json");
        let store = ConnectionStore::new(path.clone());

        store.save(&[sqlite_config()]).unwrap();

        assert_eq!(store.load().unwrap(), vec![sqlite_config()]);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn load_reports_corrupted_file_as_storage_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        fs::write(&path, "{ not json").unwrap();

        let err = ConnectionStore::new(path).load().unwrap_err();

        assert!(matches!(err, AppError::Storage(_)));
    }
}
