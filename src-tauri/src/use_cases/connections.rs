use crate::domain::{
    AppError, ConnectionConfig, Engine, KeychainOutcome, NodeAddress, SecretChange, Secrets,
    SshConfig, Target, TlsMode,
};
use crate::storage::connections::ConnectionStore;
use crate::storage::secrets::{SecretStore, sentinel_key, ssh_key};

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
/// `ssh_secret` is the tunnel's password and `sentinel_secret` the sentinels', each
/// kept under its own key; turning the tunnel or Sentinel off drops it.
pub fn save(
    store: &ConnectionStore,
    secrets: &dyn SecretStore,
    config: ConnectionConfig,
    secret: SecretChange,
    ssh_secret: SecretChange,
    sentinel_secret: SecretChange,
) -> Result<KeychainOutcome, AppError> {
    let config = normalize(config);
    let mut connections = store.load()?;
    validate(&config, &secret, &connections)?;
    let is_sentinel = matches!(config.target, Target::RedisSentinel { .. });
    if !is_sentinel && matches!(sentinel_secret, SecretChange::Set(_)) {
        return Err(AppError::validation(
            "senha do sentinel só se aplica ao Redis com sentinel",
        ));
    }

    let (had_tunnel, was_sentinel) = match connections.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => {
            let had = (
                existing.ssh.is_some(),
                matches!(existing.target, Target::RedisSentinel { .. }),
            );
            *existing = config.clone();
            had
        }
        None => {
            connections.push(config.clone());
            (false, false)
        }
    };
    store.save(&connections)?;

    let ssh_secret = match (&config.ssh, had_tunnel) {
        (Some(_), _) => ssh_secret,
        (None, true) => SecretChange::Clear,
        (None, false) => SecretChange::Keep,
    };
    let sentinel_secret = match (is_sentinel, was_sentinel) {
        (true, _) => sentinel_secret,
        (false, true) => SecretChange::Clear,
        (false, false) => SecretChange::Keep,
    };
    let password = apply(secrets, &config.id, secret, str::to_owned);
    let ssh_password = apply(secrets, &config.id, ssh_secret, ssh_key);
    let sentinel_password = apply(secrets, &config.id, sentinel_secret, sentinel_key);
    Ok(KeychainOutcome {
        keychain_warning: password
            .and(ssh_password)
            .and(sentinel_password)
            .err()
            .map(|err| err.to_string()),
    })
}

/// Applies a change to the secret stored under `key(id)`.
fn apply(
    secrets: &dyn SecretStore,
    id: &str,
    change: SecretChange,
    key: fn(&str) -> String,
) -> Result<(), AppError> {
    match change {
        SecretChange::Keep => Ok(()),
        SecretChange::Set(secret) => secrets.set(&key(id), &secret),
        SecretChange::Clear => secrets.delete(&key(id)),
        // nothing stored under the source copies as nothing: the new one has no secret yet
        SecretChange::CopyFrom(source) => match secrets.get(&key(&source))? {
            Some(secret) => secrets.set(&key(id), &secret),
            None => Ok(()),
        },
    }
}

/// The secret a draft would connect with, read without touching the keychain's contents:
/// a new one as typed, the saved one when kept or copied, none when cleared.
fn draft_secret(
    secrets: &dyn SecretStore,
    id: &str,
    change: SecretChange,
    key: fn(&str) -> String,
) -> Result<Option<String>, AppError> {
    match change {
        SecretChange::Clear => Ok(None),
        SecretChange::Set(secret) => Ok(Some(secret)),
        SecretChange::Keep => secrets.get(&key(id)),
        SecretChange::CopyFrom(source) => secrets.get(&key(&source)),
    }
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

    let password = secrets.delete(id);
    let ssh_password = secrets.delete(&ssh_key(id));
    let sentinel_password = secrets.delete(&sentinel_key(id));
    Ok(KeychainOutcome {
        keychain_warning: password
            .and(ssh_password)
            .and(sentinel_password)
            .err()
            .map(|err| err.to_string()),
    })
}

/// Trims text fields and turns empty optional strings into None.
fn normalize(mut config: ConnectionConfig) -> ConnectionConfig {
    config.name = config.name.trim().to_string();
    config.group = non_empty(config.group);
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
        Target::Uri { database } => Target::Uri {
            database: database.trim().to_string(),
        },
        Target::RedisCluster { nodes, username } => Target::RedisCluster {
            nodes: trim_nodes(nodes),
            username: username.trim().to_string(),
        },
        Target::RedisSentinel {
            nodes,
            master_name,
            database,
            username,
        } => Target::RedisSentinel {
            nodes: trim_nodes(nodes),
            master_name: master_name.trim().to_string(),
            database: database.trim().to_string(),
            username: username.trim().to_string(),
        },
    };
    config.tls.ca_cert_path = non_empty(config.tls.ca_cert_path);
    // the separator is meaningful with spaces (" | "), so it is not trimmed
    config.key_separator = config.key_separator.filter(|s| !s.is_empty());
    config.ssh = config.ssh.map(|ssh| SshConfig {
        host: ssh.host.trim().to_string(),
        user: non_empty(ssh.user),
        identity_file: non_empty(ssh.identity_file),
        ..ssh
    });
    config
}

fn trim_nodes(nodes: Vec<NodeAddress>) -> Vec<NodeAddress> {
    nodes
        .into_iter()
        .map(|node| NodeAddress {
            host: node.host.trim().to_string(),
            ..node
        })
        .collect()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// A draft to test: the same rules as saving, minus the name (it does not reach
/// the database). Returns the normalized config and the secrets it would connect
/// with (database, then tunnel), without writing to the keychain.
pub fn prepare_test(
    store: &ConnectionStore,
    secrets: &dyn SecretStore,
    config: ConnectionConfig,
    secret: SecretChange,
    ssh_secret: SecretChange,
    sentinel_secret: SecretChange,
) -> Result<(ConnectionConfig, Secrets), AppError> {
    let config = normalize(config);
    if config.id.trim().is_empty() {
        return Err(AppError::validation("id da conexão ausente"));
    }
    validate_target(&config, &secret, &store.load()?)?;
    let password = match config.engine {
        Engine::Sqlite => None,
        _ => draft_secret(secrets, &config.id, secret, str::to_owned)?,
    };
    let ssh_password = match config.ssh {
        Some(_) => draft_secret(secrets, &config.id, ssh_secret, ssh_key)?,
        None => None,
    };
    let sentinel_password = match config.target {
        Target::RedisSentinel { .. } => {
            draft_secret(secrets, &config.id, sentinel_secret, sentinel_key)?
        }
        _ => None,
    };
    let secrets = Secrets {
        password,
        ssh_password,
        sentinel_password,
    };
    Ok((config, secrets))
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
    validate_target(config, secret, existing)
}

/// Engine, target, secret and Redis separator: everything a connection attempt depends on.
fn validate_target(
    config: &ConnectionConfig,
    secret: &SecretChange,
    existing: &[ConnectionConfig],
) -> Result<(), AppError> {
    let invalid = |msg: &str| Err(AppError::validation(msg));

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
        (Engine::Sqlite, Target::Network { .. } | Target::Uri { .. }) => {
            return invalid("SQLite precisa de um arquivo, não de host/porta");
        }
        (Engine::Mongo, Target::Uri { .. }) => {
            let is_new = !existing.iter().any(|c| c.id == config.id);
            match secret {
                SecretChange::Set(uri) if !is_connection_string(uri) => {
                    return invalid(
                        "a URI de conexão deve começar com mongodb:// ou mongodb+srv://",
                    );
                }
                SecretChange::Keep | SecretChange::Clear if is_new => {
                    return invalid("informe a URI de conexão");
                }
                SecretChange::Clear => {
                    return invalid("a conexão por URI precisa da URI salva");
                }
                _ => {}
            }
        }
        (_, Target::Uri { .. }) => {
            return invalid("URI de conexão só se aplica ao MongoDB");
        }
        (Engine::Redis, Target::RedisCluster { nodes, .. }) => {
            if nodes.is_empty() {
                return invalid("informe ao menos um nó do cluster");
            }
            if nodes
                .iter()
                .any(|node| node.host.is_empty() || node.port == 0)
            {
                return invalid("cada nó do cluster precisa de host e porta");
            }
        }
        (_, Target::RedisCluster { .. }) => {
            return invalid("cluster só se aplica ao Redis");
        }
        (
            Engine::Redis,
            Target::RedisSentinel {
                nodes,
                master_name,
                database,
                ..
            },
        ) => {
            if nodes.is_empty() {
                return invalid("informe ao menos um sentinel");
            }
            if nodes
                .iter()
                .any(|node| node.host.is_empty() || node.port == 0)
            {
                return invalid("cada sentinel precisa de host e porta");
            }
            if master_name.is_empty() {
                return invalid("informe o nome do master");
            }
            if !is_valid_redis_db(database) {
                return invalid("database do Redis deve ser um número de 0 a 15");
            }
        }
        (_, Target::RedisSentinel { .. }) => {
            return invalid("sentinel só se aplica ao Redis");
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

    if let Some(ssh) = &config.ssh {
        if matches!(config.target, Target::RedisCluster { .. }) {
            // the client follows the addresses the nodes announce, which bypass the tunnel
            return invalid(
                "túnel SSH não funciona com cluster: os nós anunciam os próprios endereços",
            );
        }
        if matches!(config.target, Target::RedisSentinel { .. }) {
            return invalid(
                "túnel SSH não funciona com sentinel: o master vem pelo endereço que o sentinel anuncia",
            );
        }
        if !matches!(config.target, Target::Network { .. }) {
            return invalid("túnel SSH só se aplica a conexões por host e porta");
        }
        if ssh.host.is_empty() {
            return invalid("informe o host SSH");
        }
        if ssh.port == Some(0) {
            return invalid("porta SSH inválida");
        }
        if config.tls.mode == TlsMode::VerifyFull {
            // the adapter reaches 127.0.0.1, which is not the name on the certificate
            return invalid(
                "verificar o certificado não funciona pelo túnel SSH: use TLS \"Exigir\"",
            );
        }
    }

    match (&config.engine, &config.key_separator) {
        (Engine::Redis, None) => invalid("informe o separador de chaves do Redis"),
        (Engine::Redis, Some(_)) | (_, None) => Ok(()),
        (_, Some(_)) => invalid("separador de chaves só se aplica ao Redis"),
    }
}

fn is_connection_string(uri: &str) -> bool {
    let uri = uri.trim();
    uri.starts_with("mongodb://") || uri.starts_with("mongodb+srv://")
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
            ssh: None,
            group: None,
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
            ssh: None,
            group: None,
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
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        save(
            &store,
            &secrets,
            postgres("1", "renamed"),
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Clear,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(secrets.stored("1"), None);
    }

    #[test]
    fn save_copy_from_copies_the_stored_secret_to_the_new_id() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        save(
            &store,
            &secrets,
            postgres("2", "nada"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        save(
            &store,
            &secrets,
            postgres("3", "pg (cópia)"),
            SecretChange::CopyFrom("1".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        // a source without a secret copies as none
        save(
            &store,
            &secrets,
            postgres("4", "nada (cópia)"),
            SecretChange::CopyFrom("2".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(secrets.stored("3").as_deref(), Some("pw"));
        assert_eq!(secrets.stored("1").as_deref(), Some("pw"));
        assert_eq!(secrets.stored("4"), None);
        let (_, Secrets { password, .. }) = prepare_test(
            &store,
            &secrets,
            postgres("5", "draft"),
            SecretChange::CopyFrom("1".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(password.as_deref(), Some("pw"));
    }

    #[test]
    fn a_new_mongo_uri_connection_may_copy_the_uri() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            mongo_uri("1"),
            SecretChange::Set("mongodb://u:p@h/".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        let mut copy = mongo_uri("2");
        copy.name = "copy".into();

        save(
            &store,
            &secrets,
            copy,
            SecretChange::CopyFrom("1".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(secrets.stored("2").as_deref(), Some("mongodb://u:p@h/"));
    }

    #[test]
    fn save_keeps_metadata_and_warns_when_keychain_is_unavailable() {
        let (_dir, store) = store();

        let outcome = save(
            &store,
            &BrokenKeychain,
            postgres("1", "pg"),
            SecretChange::Set("pw".into()),
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
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
        assert_eq!(saved.ssh, None);
    }

    #[test]
    fn save_trims_the_group_and_an_empty_one_is_none() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        let mut grouped = postgres("1", "a");
        grouped.group = Some(" Cliente X ".into());
        let mut blank = postgres("2", "b");
        blank.group = Some("  ".into());

        save(
            &store,
            &secrets,
            grouped,
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        save(
            &store,
            &secrets,
            blank,
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let groups: Vec<_> = list(&store).unwrap().into_iter().map(|c| c.group).collect();
        assert_eq!(groups, [Some("Cliente X".to_string()), None]);
    }

    #[test]
    fn save_trims_ssh_fields_and_empties_become_none() {
        let (_dir, store) = store();
        let mut config = postgres("1", "pg");
        config.ssh = Some(SshConfig {
            host: " bastion ".into(),
            port: Some(2222),
            user: Some("  ".into()),
            identity_file: Some(" ~/.ssh/id ".into()),
        });

        save(
            &store,
            &MemorySecrets::default(),
            config,
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(
            list(&store).unwrap()[0].ssh,
            Some(SshConfig {
                host: "bastion".into(),
                port: Some(2222),
                user: None,
                identity_file: Some("~/.ssh/id".into()),
            })
        );
    }

    #[test]
    fn list_sorts_by_name_case_insensitively() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "beta"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        save(
            &store,
            &secrets,
            postgres("2", "Alpha"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let names: Vec<String> = list(&store).unwrap().into_iter().map(|c| c.name).collect();

        assert_eq!(names, vec!["Alpha", "beta"]);
    }

    #[test]
    fn save_accepts_valid_sqlite_and_redis() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();

        save(
            &store,
            &secrets,
            sqlite("1"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        save(
            &store,
            &secrets,
            redis("2"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

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
        let ssh = |host: &str, port| {
            Some(SshConfig {
                host: host.into(),
                port,
                user: None,
                identity_file: None,
            })
        };
        let mut sqlite_with_ssh = sqlite("1");
        sqlite_with_ssh.ssh = ssh("bastion", None);
        let mut ssh_no_host = postgres("1", "pg");
        ssh_no_host.ssh = ssh(" ", None);
        let mut ssh_port_zero = postgres("1", "pg");
        ssh_port_zero.ssh = ssh("bastion", Some(0));
        let mut ssh_verify_full = postgres("1", "pg");
        ssh_verify_full.ssh = ssh("bastion", None);
        ssh_verify_full.tls.mode = TlsMode::VerifyFull;

        let cases = [
            (
                sqlite_with_ssh,
                SecretChange::Keep,
                "túnel SSH só se aplica a conexões por host e porta",
            ),
            (ssh_no_host, SecretChange::Keep, "informe o host SSH"),
            (ssh_port_zero, SecretChange::Keep, "porta SSH inválida"),
            (
                ssh_verify_full,
                SecretChange::Keep,
                "verificar o certificado não funciona pelo túnel SSH: use TLS \"Exigir\"",
            ),
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
            let msg = validation_message(save(
                &store,
                &MemorySecrets::default(),
                config,
                secret,
                SecretChange::Keep,
                SecretChange::Keep,
            ));
            assert_eq!(msg, expected);
        }
    }

    fn redis_cluster(id: &str, nodes: &[(&str, u16)]) -> ConnectionConfig {
        ConnectionConfig {
            target: Target::RedisCluster {
                nodes: nodes
                    .iter()
                    .map(|(host, port)| NodeAddress {
                        host: (*host).into(),
                        port: *port,
                    })
                    .collect(),
                username: String::new(),
            },
            ..redis(id)
        }
    }

    #[test]
    fn redis_cluster_validation() {
        let (_dir, saved) = store();
        let secrets = MemorySecrets::default();
        save(
            &saved,
            &secrets,
            redis_cluster("1", &[(" a ", 7000), ("b", 7001)]),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        let Target::RedisCluster { nodes, .. } = &list(&saved).unwrap()[0].target else {
            panic!("cluster target");
        };
        assert_eq!(nodes[0].host, "a");

        let mut with_ssh = redis_cluster("1", &[("a", 7000)]);
        with_ssh.ssh = Some(SshConfig {
            host: "bastion".into(),
            port: None,
            user: None,
            identity_file: None,
        });
        let mut on_postgres = redis_cluster("1", &[("a", 7000)]);
        on_postgres.engine = Engine::Postgres;
        on_postgres.key_separator = None;
        let cases = [
            (redis_cluster("1", &[]), "informe ao menos um nó do cluster"),
            (
                redis_cluster("1", &[("a", 7000), (" ", 7001)]),
                "cada nó do cluster precisa de host e porta",
            ),
            (
                redis_cluster("1", &[("a", 0)]),
                "cada nó do cluster precisa de host e porta",
            ),
            (
                with_ssh,
                "túnel SSH não funciona com cluster: os nós anunciam os próprios endereços",
            ),
            (on_postgres, "cluster só se aplica ao Redis"),
        ];
        for (config, expected) in cases {
            let (_dir, store) = store();
            let msg = validation_message(save(
                &store,
                &secrets,
                config,
                SecretChange::Keep,
                SecretChange::Keep,
                SecretChange::Keep,
            ));
            assert_eq!(msg, expected);
        }
    }

    fn redis_sentinel(id: &str) -> ConnectionConfig {
        ConnectionConfig {
            target: Target::RedisSentinel {
                nodes: vec![NodeAddress {
                    host: " s1 ".into(),
                    port: 26379,
                }],
                master_name: " main ".into(),
                database: "0".into(),
                username: String::new(),
            },
            ..redis(id)
        }
    }

    #[test]
    fn sentinel_password_is_a_keychain_entry_of_its_own() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        let sentinel = sentinel_key("1");

        save(
            &store,
            &secrets,
            redis_sentinel("1"),
            SecretChange::Set("redis-pw".into()),
            SecretChange::Keep,
            SecretChange::Set("sentinel-pw".into()),
        )
        .unwrap();
        assert_eq!(secrets.stored("1").as_deref(), Some("redis-pw"));
        assert_eq!(secrets.stored(&sentinel).as_deref(), Some("sentinel-pw"));
        let Target::RedisSentinel {
            nodes, master_name, ..
        } = &list(&store).unwrap()[0].target
        else {
            panic!("sentinel target");
        };
        assert_eq!(
            (nodes[0].host.as_str(), master_name.as_str()),
            ("s1", "main")
        );

        let (_, draft) = prepare_test(
            &store,
            &secrets,
            redis_sentinel("1"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(draft.password.as_deref(), Some("redis-pw"));
        assert_eq!(draft.sentinel_password.as_deref(), Some("sentinel-pw"));

        // a duplicate copies it like the other secrets
        save(
            &store,
            &secrets,
            ConnectionConfig {
                name: "copy".into(),
                ..redis_sentinel("2")
            },
            SecretChange::CopyFrom("1".into()),
            SecretChange::Keep,
            SecretChange::CopyFrom("1".into()),
        )
        .unwrap();
        assert_eq!(
            secrets.stored(&sentinel_key("2")).as_deref(),
            Some("sentinel-pw")
        );

        // leaving sentinel drops its password; deleting drops all of them
        save(
            &store,
            &secrets,
            redis("1"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(secrets.stored(&sentinel), None);
        assert_eq!(secrets.stored("1").as_deref(), Some("redis-pw"));
        delete(&store, &secrets, "2").unwrap();
        assert_eq!(secrets.stored("2"), None);
        assert_eq!(secrets.stored(&sentinel_key("2")), None);
    }

    #[test]
    fn redis_sentinel_validation() {
        let secrets = MemorySecrets::default();
        let target =
            |nodes: Vec<NodeAddress>, master_name: &str, database: &str| Target::RedisSentinel {
                nodes,
                master_name: master_name.into(),
                database: database.into(),
                username: String::new(),
            };
        let node = || {
            vec![NodeAddress {
                host: "s".into(),
                port: 26379,
            }]
        };
        let with_target = |target| ConnectionConfig {
            target,
            ..redis_sentinel("1")
        };
        let mut with_ssh = redis_sentinel("1");
        with_ssh.ssh = Some(SshConfig {
            host: "bastion".into(),
            port: None,
            user: None,
            identity_file: None,
        });
        let cases = [
            (
                with_target(target(Vec::new(), "m", "0")),
                SecretChange::Keep,
                "informe ao menos um sentinel",
            ),
            (
                with_target(target(node(), " ", "0")),
                SecretChange::Keep,
                "informe o nome do master",
            ),
            (
                with_target(target(node(), "m", "16")),
                SecretChange::Keep,
                "database do Redis deve ser um número de 0 a 15",
            ),
            (
                with_ssh,
                SecretChange::Keep,
                "túnel SSH não funciona com sentinel: o master vem pelo endereço que o sentinel anuncia",
            ),
            (
                redis("1"),
                SecretChange::Set("pw".into()),
                "senha do sentinel só se aplica ao Redis com sentinel",
            ),
        ];
        for (config, sentinel_secret, expected) in cases {
            let (_dir, store) = store();
            let msg = validation_message(save(
                &store,
                &secrets,
                config,
                SecretChange::Keep,
                SecretChange::Keep,
                sentinel_secret,
            ));
            assert_eq!(msg, expected);
        }
    }

    fn mongo_uri(id: &str) -> ConnectionConfig {
        ConnectionConfig {
            engine: Engine::Mongo,
            target: Target::Uri {
                database: " shop ".into(),
            },
            ..postgres(id, "atlas")
        }
    }

    #[test]
    fn mongo_connection_string_lives_in_the_keychain() {
        let (dir, store) = store();
        let secrets = MemorySecrets::default();
        let uri = "mongodb+srv://me:s3cret@cluster0.example.net/?retryWrites=true";

        save(
            &store,
            &secrets,
            mongo_uri("1"),
            SecretChange::Set(uri.into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        // editing later can keep it
        save(
            &store,
            &secrets,
            mongo_uri("1"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(secrets.stored("1").as_deref(), Some(uri));
        assert_eq!(
            list(&store).unwrap()[0].target,
            Target::Uri {
                database: "shop".into()
            }
        );
        let raw = std::fs::read_to_string(dir.path().join("connections.json")).unwrap();
        assert!(!raw.contains("s3cret"));
    }

    #[test]
    fn mongo_connection_string_validation() {
        let cases = [
            (
                mongo_uri("1"),
                SecretChange::Keep,
                "informe a URI de conexão",
            ),
            (
                mongo_uri("1"),
                SecretChange::Set("http://x".into()),
                "a URI de conexão deve começar com mongodb:// ou mongodb+srv://",
            ),
            (
                ConnectionConfig {
                    target: Target::Uri {
                        database: String::new(),
                    },
                    ..postgres("1", "pg")
                },
                SecretChange::Keep,
                "URI de conexão só se aplica ao MongoDB",
            ),
        ];
        for (config, secret, expected) in cases {
            let (_dir, store) = store();
            assert_eq!(
                validation_message(save(
                    &store,
                    &MemorySecrets::default(),
                    config,
                    secret,
                    SecretChange::Keep,
                    SecretChange::Keep
                )),
                expected
            );
        }

        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            mongo_uri("1"),
            SecretChange::Set("mongodb://h".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(
            validation_message(save(
                &store,
                &secrets,
                mongo_uri("1"),
                SecretChange::Clear,
                SecretChange::Keep,
                SecretChange::Keep
            )),
            "a conexão por URI precisa da URI salva"
        );
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
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let msg = validation_message(save(
            &store,
            &secrets,
            postgres("2", "prod db"),
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let outcome = delete(&store, &secrets, "1").unwrap();

        assert_eq!(outcome.keychain_warning, None);
        assert!(list(&store).unwrap().is_empty());
        assert_eq!(secrets.stored("1"), None);
    }

    fn tunneled(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            ssh: Some(SshConfig {
                host: "bastion".into(),
                port: None,
                user: None,
                identity_file: None,
            }),
            ..postgres(id, name)
        }
    }

    #[test]
    fn the_ssh_password_has_its_own_key_and_follows_the_tunnel() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        let ssh = |change| {
            save(
                &store,
                &secrets,
                tunneled("1", "pg"),
                SecretChange::Keep,
                change,
                SecretChange::Keep,
            )
        };

        ssh(SecretChange::Set("ssh-pw".into())).unwrap();
        assert_eq!(secrets.stored("1:ssh").as_deref(), Some("ssh-pw"));
        assert_eq!(secrets.stored("1"), None);
        ssh(SecretChange::Keep).unwrap();
        assert_eq!(secrets.stored("1:ssh").as_deref(), Some("ssh-pw"));

        // a copy takes the tunnel's password along with the database's
        let copy = SecretChange::CopyFrom("1".into());
        save(
            &store,
            &secrets,
            tunneled("2", "copy"),
            copy.clone(),
            copy,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(secrets.stored("2:ssh").as_deref(), Some("ssh-pw"));

        // turning the tunnel off drops its password, whatever the form sent
        let set = SecretChange::Set("ignored".into());
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Keep,
            set,
            SecretChange::Keep,
        )
        .unwrap();
        assert_eq!(secrets.stored("1:ssh"), None);

        delete(&store, &secrets, "2").unwrap();
        assert_eq!(secrets.stored("2:ssh"), None);
    }

    #[test]
    fn test_draft_reads_the_ssh_password_only_with_a_tunnel() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        let ssh_pw = SecretChange::Set("ssh-pw".into());
        save(
            &store,
            &secrets,
            tunneled("1", "pg"),
            SecretChange::Keep,
            ssh_pw.clone(),
            SecretChange::Keep,
        )
        .unwrap();
        let draft = |config, ssh_secret| {
            prepare_test(
                &store,
                &secrets,
                config,
                SecretChange::Keep,
                ssh_secret,
                SecretChange::Keep,
            )
            .unwrap()
            .1
            .ssh_password
        };

        assert_eq!(
            draft(tunneled("1", "pg"), SecretChange::Keep).as_deref(),
            Some("ssh-pw")
        );
        assert_eq!(draft(tunneled("1", "pg"), SecretChange::Clear), None);
        assert_eq!(draft(postgres("1", "pg"), ssh_pw), None);
    }

    #[test]
    fn find_returns_the_connection_or_not_found() {
        let (_dir, store) = store();
        save(
            &store,
            &MemorySecrets::default(),
            postgres("1", "pg"),
            SecretChange::Keep,
            SecretChange::Keep,
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
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let outcome = delete(&store, &BrokenKeychain, "1").unwrap();

        assert!(outcome.keychain_warning.is_some());
        assert!(list(&store).unwrap().is_empty());
    }

    #[test]
    fn test_draft_uses_the_typed_secret_and_writes_nothing() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();

        // a draft needs no name and is not stored
        let (config, Secrets { password, .. }) = prepare_test(
            &store,
            &secrets,
            postgres("1", "  "),
            SecretChange::Set("typed".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(config.name, "");
        assert_eq!(password.as_deref(), Some("typed"));
        assert!(list(&store).unwrap().is_empty());
        assert_eq!(secrets.stored("1"), None);
    }

    #[test]
    fn test_draft_keeps_the_saved_secret_or_drops_it() {
        let (_dir, store) = store();
        let secrets = MemorySecrets::default();
        save(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Set("saved".into()),
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        let keep = prepare_test(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        let clear = prepare_test(
            &store,
            &secrets,
            postgres("1", "pg"),
            SecretChange::Clear,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();
        let file = prepare_test(
            &store,
            &secrets,
            sqlite("2"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap();

        assert_eq!(keep.1.password.as_deref(), Some("saved"));
        assert_eq!(clear.1.password, None);
        assert_eq!(file.1.password, None);
        // testing never changes what is stored
        assert_eq!(secrets.stored("1").as_deref(), Some("saved"));
    }

    #[test]
    fn test_draft_is_validated_like_a_save() {
        let (_dir, store) = store();
        let mut no_host = postgres("1", "pg");
        no_host.target = Target::Network {
            host: " ".into(),
            port: 5432,
            database: "app".into(),
            username: "postgres".into(),
        };

        let err = prepare_test(
            &store,
            &MemorySecrets::default(),
            no_host,
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap_err();
        let new_uri = prepare_test(
            &store,
            &MemorySecrets::default(),
            mongo_uri("2"),
            SecretChange::Keep,
            SecretChange::Keep,
            SecretChange::Keep,
        )
        .unwrap_err();

        assert_eq!(err.to_string(), "informe o host");
        assert_eq!(new_uri.to_string(), "informe a URI de conexão");
    }
}
