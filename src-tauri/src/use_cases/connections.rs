use crate::domain::{
    AppError, ConnectionConfig, Engine, KeychainOutcome, SecretChange, Target, TlsMode,
};
use crate::storage::connections::ConnectionStore;
use crate::storage::secrets::SecretStore;

const REDIS_MAX_DB: u8 = 15;

pub fn list(store: &ConnectionStore) -> Result<Vec<ConnectionConfig>, AppError> {
    let mut connections = store.load()?;
    connections.sort_by_key(|c| c.name.to_lowercase());
    Ok(connections)
}

pub fn find(store: &ConnectionStore, id: &str) -> Result<ConnectionConfig, AppError> {
    store
        .load()?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::not_found(&format!("conexão {id}")))
}

/// Upserts by id. Metadata is written first; a keychain failure after that is
/// returned as a warning so the user knows the password was not stored.
pub fn save(
    store: &ConnectionStore,
    secrets: &dyn SecretStore,
    config: ConnectionConfig,
    secret: SecretChange,
) -> Result<KeychainOutcome, AppError> {
    let config = normalize(config);
    let mut connections = store.load()?;
    validate(&config, &secret, &connections)?;

    match connections.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => *existing = config.clone(),
        None => connections.push(config.clone()),
    }
    store.save(&connections)?;

    let keychain_result = match secret {
        SecretChange::Keep => Ok(()),
        SecretChange::Set(password) => secrets.set(&config.id, &password),
        SecretChange::Clear => secrets.delete(&config.id),
    };
    Ok(KeychainOutcome {
        keychain_warning: keychain_result.err().map(|err| err.to_string()),
    })
}

pub fn delete(
    store: &ConnectionStore,
    secrets: &dyn SecretStore,
    id: &str,
) -> Result<KeychainOutcome, AppError> {
    let mut connections = store.load()?;
    let before = connections.len();
    connections.retain(|c| c.id != id);
    if connections.len() == before {
        return Err(AppError::not_found(&format!("conexão {id}")));
    }
    store.save(&connections)?;

    Ok(KeychainOutcome {
        keychain_warning: secrets.delete(id).err().map(|err| err.to_string()),
    })
}

/// Trims text fields and turns empty optional strings into None.
fn normalize(mut config: ConnectionConfig) -> ConnectionConfig {
    config.name = config.name.trim().to_string();
    config.target = match config.target {
        Target::Network {
            host,
            port,
            database,
            username,
        } => Target::Network {
            host: host.trim().to_string(),
            port,
            database: database.trim().to_string(),
            username: username.trim().to_string(),
        },
        Target::File { path } => Target::File {
            path: path.trim().to_string(),
        },
    };
    config.tls.ca_cert_path = non_empty(config.tls.ca_cert_path);
    // the separator is meaningful with spaces (" | "), so it is not trimmed
    config.key_separator = config.key_separator.filter(|s| !s.is_empty());
    config
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn validate(
    config: &ConnectionConfig,
    secret: &SecretChange,
    existing: &[ConnectionConfig],
) -> Result<(), AppError> {
    let invalid = |msg: &str| Err(AppError::validation(msg));

    if config.id.trim().is_empty() {
        return invalid("id da conexão ausente");
    }
    if config.name.is_empty() {
        return invalid("informe um nome");
    }
    let name_taken = existing
        .iter()
        .any(|c| c.id != config.id && c.name.eq_ignore_ascii_case(&config.name));
    if name_taken {
        return invalid("já existe uma conexão com esse nome");
    }

    match (&config.engine, &config.target) {
        (Engine::Sqlite, Target::File { path }) => {
            if path.is_empty() {
                return invalid("informe o caminho do arquivo SQLite");
            }
            if config.tls.mode != TlsMode::Disable {
                return invalid("TLS não se aplica a SQLite");
            }
            if matches!(secret, SecretChange::Set(_)) {
                return invalid("SQLite não usa senha");
            }
        }
        (Engine::Sqlite, Target::Network { .. }) => {
            return invalid("SQLite precisa de um arquivo, não de host/porta");
        }
        (_, Target::File { .. }) => {
            return invalid("este banco precisa de host/porta, não de arquivo");
        }
        (
            engine,
            Target::Network {
                host,
                port,
                database,
                ..
            },
        ) => {
            if host.is_empty() {
                return invalid("informe o host");
            }
            if *port == 0 {
                return invalid("porta inválida");
            }
            if *engine == Engine::Redis && !is_valid_redis_db(database) {
                return invalid("database do Redis deve ser um número de 0 a 15");
            }
        }
    }

    match (&config.engine, &config.key_separator) {
        (Engine::Redis, None) => invalid("informe o separador de chaves do Redis"),
        (Engine::Redis, Some(_)) | (_, None) => Ok(()),
        (_, Some(_)) => invalid("separador de chaves só se aplica ao Redis"),
    }
}

fn is_valid_redis_db(database: &str) -> bool {
    database.is_empty() || database.parse::<u8>().is_ok_and(|db| db <= REDIS_MAX_DB)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Environment, TlsConfig};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemorySecrets(Mutex<HashMap<String, String>>);

    impl MemorySecrets {
        fn stored(&self, id: &str) -> Option<String> {
            self.0.lock().unwrap().get(id).cloned()
        }
    }

    impl SecretStore for MemorySecrets {
        fn get(&self, id: &str) -> Result<Option<String>, AppError> {
            Ok(self.stored(id))
        }
        fn set(&self, id: &str, secret: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(id.into(), secret.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }

    struct BrokenKeychain;

    impl SecretStore for BrokenKeychain {
        fn get(&self, _: &str) -> Result<Option<String>, AppError> {
            Err(AppError::keychain("no secret service"))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AppError> {
            Err(AppError::keychain("no secret service"))
        }
        fn delete(&self, _: &str) -> Result<(), AppError> {
            Err(AppError::keychain("no secret service"))
        }
    }

    fn store() -> (tempfile::TempDir, ConnectionStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ConnectionStore::new(dir.path().join("connections.json"));
        (dir, store)
    }

    fn postgres(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.into(),
            name: name.into(),
            engine: Engine::Postgres,
            environment: Environment::Dev,
            read_only: false,
            timeout_secs: 30,
            target: Target::Network {
                host: "localhost".into(),
                port: 5432,
                database: "app".into(),
                username: "postgres".into(),
            },
            tls: TlsConfig {
                mode: TlsMode::Prefer,
                ca_cert_path: None,
            },
            key_separator: None,
        }
    }

    fn sqlite(id: &str) -> ConnectionConfig {
        ConnectionConfig {
            engine: Engine::Sqlite,
            target: Target::File {
                path: "/tmp/app.db".into(),
            },
            tls: TlsConfig {
                mode: TlsMode::Disable,
                ca_cert_path: None,
            },
            ..postgres(id, "sqlite")
        }
    }

    fn redis(id: &str) -> ConnectionConfig {
        ConnectionConfig {
            engine: Engine::Redis,
            target: Target::Network {
                host: "localhost".into(),
                port: 6379,
                database: "0".into(),
                username: String::new(),
            },
            key_separator: Some(":".into()),
            ..postgres(id, "redis")
        }
    }

    fn validation_message(result: Result<KeychainOutcome, AppError>) -> String {
        match result {
            Err(AppError::Validation(msg)) => msg,
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn save_creates_connection_and_stores_password_in_keychain() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();

        let outcome = save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("s3cret".into()),
        )
        .unwrap();

        assert_eq!(outcome.keychain_warning, None);
        assert_eq!(list(&store).unwrap(), vec![postgres("1", "pg")]);
        assert_eq!(secrets.stored("1").as_deref(), Some("s3cret"));
    }

    #[test]
    fn save_never_writes_the_password_to_connections_json() {
        let (dir, store) = store();
        save(
            &store,
            &MemorySecrets::default(),
            postgres("1", "pg"),
            SecretChange::Set("s3cret".into()),
        )
        .unwrap();

        let raw = std::fs::read_to_string(dir.path().join("connections.json")).unwrap();
        assert!(!raw.contains("s3cret"));
    }

    #[test]
    fn save_updates_existing_connection_and_keeps_password() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
        )
        .unwrap();

        save(
            &store,
            &secrets,
            postgres("1", "renamed"),
            SecretChange::Keep,
        )
        .unwrap();

        let all = list(&store).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "renamed");
        assert_eq!(secrets.stored("1").as_deref(), Some("pw"));
    }

    #[test]
    fn save_clear_removes_password() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
        )
        .unwrap();

        save(&store, &secrets, postgres("1", "pg"), SecretChange::Clear).unwrap();

        assert_eq!(secrets.stored("1"), None);
    }

    #[test]
    fn save_keeps_metadata_and_warns_when_keychain_is_unavailable() {
        let (_dir, store) = store();

        let outcome = save(
            &store,
            &BrokenKeychain,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
        )
        .unwrap();

        assert_eq!(
            outcome.keychain_warning.as_deref(),
            Some("keychain indisponível: no secret service")
        );
        assert_eq!(list(&store).unwrap().len(), 1);
    }

    #[test]
    fn save_trims_fields_and_drops_empty_ca_path() {
        let (_dir, store) = store();
        let mut config = postgres("1", "  pg  ");
        config.target = Target::Network {
            host: " db.local ".into(),
            port: 5432,
            database: " app ".into(),
            username: " me ".into(),
        };
        config.tls.ca_cert_path = Some("   ".into());

        save(
            &store,
            &MemorySecrets::default(),
            config,
            SecretChange::Keep,
        )
        .unwrap();

        let saved = &list(&store).unwrap()[0];
        assert_eq!(saved.name, "pg");
        assert_eq!(
            saved.target,
            Target::Network {
                host: "db.local".into(),
                port: 5432,
                database: "app".into(),
                username: "me".into(),
            }
        );
        assert_eq!(saved.tls.ca_cert_path, None);
    }

    #[test]
    fn list_sorts_by_name_case_insensitively() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(&store, &secrets, postgres("1", "beta"), SecretChange::Keep).unwrap();
        save(&store, &secrets, postgres("2", "Alpha"), SecretChange::Keep).unwrap();

        let names: Vec<String> = list(&store).unwrap().into_iter().map(|c| c.name).collect();

        assert_eq!(names, vec!["Alpha", "beta"]);
    }

    #[test]
    fn save_accepts_valid_sqlite_and_redis() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();

        save(&store, &secrets, sqlite("1"), SecretChange::Keep).unwrap();
        save(&store, &secrets, redis("2"), SecretChange::Keep).unwrap();

        assert_eq!(list(&store).unwrap().len(), 2);
    }

    #[test]
    fn save_rejects_invalid_configs() {
        let mut no_id = postgres("", "pg");
        no_id.id = "  ".into();
        let mut no_host = postgres("1", "pg");
        no_host.target = Target::Network {
            host: " ".into(),
            port: 5432,
            database: String::new(),
            username: String::new(),
        };
        let mut port_zero = postgres("1", "pg");
        port_zero.target = Target::Network {
            host: "h".into(),
            port: 0,
            database: String::new(),
            username: String::new(),
        };
        let mut sqlite_with_tls = sqlite("1");
        sqlite_with_tls.tls.mode = TlsMode::Require;
        let mut sqlite_empty_path = sqlite("1");
        sqlite_empty_path.target = Target::File { path: " ".into() };
        let mut sqlite_with_host = sqlite("1");
        sqlite_with_host.target = postgres("1", "x").target;
        let mut postgres_with_file = postgres("1", "pg");
        postgres_with_file.target = Target::File {
            path: "/a.db".into(),
        };
        let mut redis_bad_db = redis("1");
        redis_bad_db.target = Target::Network {
            host: "h".into(),
            port: 6379,
            database: "16".into(),
            username: String::new(),
        };
        let mut redis_no_separator = redis("1");
        redis_no_separator.key_separator = Some(String::new());
        let mut postgres_with_separator = postgres("1", "pg");
        postgres_with_separator.key_separator = Some(":".into());

        let cases = [
            (no_id, SecretChange::Keep, "id da conexão ausente"),
            (postgres("1", "   "), SecretChange::Keep, "informe um nome"),
            (no_host, SecretChange::Keep, "informe o host"),
            (port_zero, SecretChange::Keep, "porta inválida"),
            (
                sqlite_with_tls,
                SecretChange::Keep,
                "TLS não se aplica a SQLite",
            ),
            (
                sqlite_empty_path,
                SecretChange::Keep,
                "informe o caminho do arquivo SQLite",
            ),
            (
                sqlite("1"),
                SecretChange::Set("pw".into()),
                "SQLite não usa senha",
            ),
            (
                sqlite_with_host,
                SecretChange::Keep,
                "SQLite precisa de um arquivo, não de host/porta",
            ),
            (
                postgres_with_file,
                SecretChange::Keep,
                "este banco precisa de host/porta, não de arquivo",
            ),
            (
                redis_bad_db,
                SecretChange::Keep,
                "database do Redis deve ser um número de 0 a 15",
            ),
            (
                redis_no_separator,
                SecretChange::Keep,
                "informe o separador de chaves do Redis",
            ),
            (
                postgres_with_separator,
                SecretChange::Keep,
                "separador de chaves só se aplica ao Redis",
            ),
        ];

        for (config, secret, expected) in cases {
            let (_dir, store) = store();
            let msg = validation_message(save(&store, &MemorySecrets::default(), config, secret));
            assert_eq!(msg, expected);
        }
    }

    #[test]
    fn save_rejects_duplicate_name_from_another_connection() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "Prod DB"),
            SecretChange::Keep,
        )
        .unwrap();

        let msg = validation_message(save(
            &store,
            &secrets,
            postgres("2", "prod db"),
            SecretChange::Keep,
        ));

        assert_eq!(msg, "já existe uma conexão com esse nome");
    }

    #[test]
    fn delete_removes_connection_and_password() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
        )
        .unwrap();

        let outcome = delete(&store, &secrets, "1").unwrap();

        assert_eq!(outcome.keychain_warning, None);
        assert!(list(&store).unwrap().is_empty());
        assert_eq!(secrets.stored("1"), None);
    }

    #[test]
    fn find_returns_the_connection_or_not_found() {
        let (_dir, store) = store();
        save(
            &store,
            &MemorySecrets::default(),
            postgres("1", "pg"),
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(find(&store, "1").unwrap().name, "pg");
        assert_eq!(
            find(&store, "2").unwrap_err().to_string(),
            "não encontrado: conexão 2"
        );
    }

    #[test]
    fn delete_unknown_id_is_not_found() {
        let (_dir, store) = store();

        let err = delete(&store, &MemorySecrets::default(), "nope").unwrap_err();

        assert_eq!(err.to_string(), "não encontrado: conexão nope");
    }

    #[test]
    fn delete_warns_when_keychain_is_unavailable() {
        let (_dir, store) = store();
        save(
            &store,
            &MemorySecrets::default(),
            postgres("1", "pg"),
            SecretChange::Keep,
        )
        .unwrap();

        let outcome = delete(&store, &BrokenKeychain, "1").unwrap();

        assert!(outcome.keychain_warning.is_some());
        assert!(list(&store).unwrap().is_empty());
    }
}
