//! Backup and restore of a whole SQL database. Postgres and MySQL go through the system's
//! client tools (`adapters/backup.rs`); SQLite copies itself with `VACUUM INTO`. The file
//! is written as `<name>.part` and renamed at the end, like the exports.

use std::path::PathBuf;
use std::time::Instant;

use crate::adapters::SqlConnection;
use crate::adapters::backup::{self, Endpoint, Job};
use crate::adapters::dialect::Dialect;
use crate::domain::{
    AppError, BackupFormat, BackupOutcome, Confirmation, ConnectionConfig, Engine, RestoreResponse,
    Target,
};
use crate::registry::{OpenConnection, Registry};
use crate::storage::history::HistoryStore;
use crate::use_cases::export::{finish, part_path, target_path};
use crate::use_cases::sql::{elapsed_ms, record};

/// Writes a backup of the connection's database to `path`. Only reads: allowed on
/// read-only connections and on prod without asking. Cancellable under `run_id`.
pub async fn backup(
    registry: &Registry,
    history: &HistoryStore,
    config: &ConnectionConfig,
    password: Option<String>,
    run_id: &str,
    format: BackupFormat,
    path: &str,
) -> Result<BackupOutcome, AppError> {
    let connection = registry.connection(&config.id)?;
    let target = target_path(path)?;
    let part = part_path(&target);
    let job = match (config.engine, format) {
        (Engine::Sqlite, BackupFormat::SqliteFile) => None,
        (Engine::Postgres, BackupFormat::Custom | BackupFormat::Sql) => Some(backup::pg_dump(
            &endpoint(config, &connection, password.as_deref())?,
            format,
            &part,
        )?),
        (Engine::Mysql, BackupFormat::Sql) => Some(backup::mysqldump(
            &endpoint(config, &connection, password.as_deref())?,
            &part,
        )),
        _ => {
            return Err(AppError::validation(
                "esse formato de backup não existe para esta conexão",
            ));
        }
    };
    let command = match &job {
        Some(job) => job.command_line(),
        None => format!(
            "VACUUM INTO {}",
            Dialect::Sqlite.quote_literal(&part.to_string_lossy())?
        ),
    };

    registry.start_run(run_id, connection.clone(), 0);
    let started = Instant::now();
    // a .part left by a crash would make VACUUM INTO fail ("output file already exists")
    let _ = std::fs::remove_file(&part);
    let result = match &job {
        Some(job) => job.run(|| registry.cancel_requested(run_id)).await,
        None => match connection.sql()? {
            SqlConnection::Sqlite(sqlite) => sqlite.execute(&command).await,
            _ => Err(AppError::validation("VACUUM INTO é do SQLite")),
        },
    }
    .and_then(|()| Ok(std::fs::metadata(&part)?.len()));
    registry.finish_run(run_id);
    let result = finish(result, &target);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        &config.id,
        &connection,
        &format!("-- backup → {}\n{command}", target.display()),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(BackupOutcome {
        command,
        // exact up to 2^53 bytes (8 PiB)
        bytes: result? as f64,
        duration_ms,
    })
}

/// Restores a backup file into the connection's database. Destructive: refused on
/// read-only connections, and the first call always answers with the exact command to
/// confirm, in every environment (the confirmation asks for the name on prod).
pub async fn restore(
    registry: &Registry,
    history: &HistoryStore,
    config: &ConnectionConfig,
    password: Option<String>,
    run_id: &str,
    path: &str,
    confirmed: bool,
) -> Result<RestoreResponse, AppError> {
    let connection = registry.connection(&config.id)?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let source = PathBuf::from(path);
    if !source.is_absolute() || !source.is_file() {
        return Err(AppError::validation("escolha o arquivo do backup"));
    }
    let file = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (job, effect): (Job, &str) = match config.engine {
        Engine::Postgres => {
            let endpoint = endpoint(config, &connection, password.as_deref())?;
            if backup::is_pg_archive(&source)? {
                (
                    backup::pg_restore(&endpoint, &source),
                    "os objetos do backup são apagados e recriados (pg_restore --clean), numa transação",
                )
            } else {
                (
                    backup::psql(&endpoint, &source),
                    "o SQL do arquivo roda como está, numa transação",
                )
            }
        }
        Engine::Mysql => (
            backup::mysql(
                &endpoint(config, &connection, password.as_deref())?,
                &source,
            ),
            "o SQL do arquivo roda como está (um mysqldump apaga e recria cada tabela); não é uma transação: um erro no meio deixa o que já rodou",
        ),
        _ => {
            return Err(AppError::validation(
                "a restauração existe para Postgres e MySQL; um SQLite se restaura copiando o arquivo do backup no lugar do banco, com a conexão fechada",
            ));
        }
    };
    let command = job.command_line();
    if !confirmed {
        return Ok(RestoreResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: format!(
                    "Restaurar {file} em {}: {effect}",
                    database(config).unwrap_or_default()
                ),
                statements: vec![command],
                destructive: true,
            },
        });
    }

    registry.start_run(run_id, connection.clone(), 0);
    let started = Instant::now();
    let result = job.run(|| registry.cancel_requested(run_id)).await;
    registry.finish_run(run_id);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        &config.id,
        &connection,
        &format!("-- restore ← {}\n{command}", source.display()),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    result?;
    Ok(RestoreResponse::Restored {
        command,
        duration_ms,
    })
}

fn database(config: &ConnectionConfig) -> Option<&str> {
    match &config.target {
        Target::Network { database, .. } => Some(database),
        _ => None,
    }
}

/// Through SSH, the tools connect to the tunnel the open session already holds.
fn endpoint<'a>(
    config: &'a ConnectionConfig,
    connection: &OpenConnection,
    password: Option<&'a str>,
) -> Result<Endpoint<'a>, AppError> {
    let Target::Network {
        host,
        port,
        database,
        username,
    } = &config.target
    else {
        return Err(AppError::validation(
            "o backup precisa de uma conexão por host e porta",
        ));
    };
    if database.trim().is_empty() {
        return Err(AppError::validation(
            "informe o database da conexão para fazer backup ou restaurar",
        ));
    }
    let (host, port) = match &connection.tunnel {
        Some(tunnel) => ("127.0.0.1", tunnel.local_port),
        None => (host.as_str(), *port),
    };
    Ok(Endpoint {
        host,
        port,
        database,
        username,
        password,
        tls: &config.tls,
    })
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::domain::{Environment, RunResponse, ScriptOutcome, StatementResult};
    use crate::storage::secrets::SecretStore;
    use crate::use_cases::sql;

    struct Password(Option<&'static str>);

    impl SecretStore for Password {
        fn get(&self, _: &str) -> Result<Option<String>, AppError> {
            Ok(self.0.map(String::from))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AppError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), AppError> {
            Ok(())
        }
    }

    /// The client tools are system binaries, like `ssh`. CI (GitHub's Ubuntu runner)
    /// has them; elsewhere a test without them says so and stops, instead of failing
    /// every `cargo test` on a machine without the PostgreSQL or MySQL client.
    fn has_tools(tools: &[&str]) -> bool {
        let missing: Vec<&str> = tools
            .iter()
            .copied()
            .filter(|tool| {
                std::process::Command::new(tool)
                    .arg("--version")
                    .output()
                    .is_err()
            })
            .collect();
        if missing.is_empty() {
            return true;
        }
        assert!(
            std::env::var_os("CI").is_none(),
            "CI precisa de {missing:?} no PATH"
        );
        eprintln!("PULADO: {missing:?} fora do PATH");
        false
    }

    async fn exec(
        registry: &Registry,
        history: &HistoryStore,
        id: &str,
        sql: &str,
    ) -> ScriptOutcome {
        match sql::run_script(registry, history, id, "run", sql, true)
            .await
            .unwrap()
        {
            RunResponse::Executed { outcome } => outcome,
            RunResponse::NeedsConfirmation { .. } => unreachable!("confirmed"),
        }
    }

    async fn names(registry: &Registry, history: &HistoryStore, id: &str) -> Vec<String> {
        let outcome = exec(registry, history, id, "SELECT name FROM t ORDER BY id").await;
        let StatementResult::Rows { batch, .. } = outcome.into_last().unwrap() else {
            panic!("expected rows");
        };
        batch
            .rows
            .into_iter()
            .map(|row| match &row[0] {
                crate::domain::Cell::Text(text) => text.clone(),
                other => panic!("{other:?}"),
            })
            .collect()
    }

    fn confirmation(response: RestoreResponse) -> Confirmation {
        match response {
            RestoreResponse::NeedsConfirmation { confirmation } => confirmation,
            RestoreResponse::Restored { .. } => panic!("restored without confirmation"),
        }
    }

    #[tokio::test]
    async fn postgres_backs_up_and_restores_with_the_system_tools() {
        if !has_tools(&["pg_dump", "pg_restore", "psql"]) {
            return;
        }
        let (_container, mut config) = crate::adapters::postgres::integration_tests::start().await;
        config.environment = Environment::Prod;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let secrets = Password(Some("postgres"));
        sql::connect(&registry, &secrets, config.clone())
            .await
            .unwrap();
        exec(
            &registry,
            &history,
            "it",
            "CREATE TABLE t (id int PRIMARY KEY, name text); INSERT INTO t VALUES (1, 'a''b'), (2, 'ç')",
        )
        .await;
        let dir = tempfile::tempdir().unwrap();
        let custom = dir.path().join("app.dump");
        let plain = dir.path().join("app.sql");

        let outcome = backup(
            &registry,
            &history,
            &config,
            Some("postgres".into()),
            "b1",
            BackupFormat::Custom,
            &custom.to_string_lossy(),
        )
        .await
        .unwrap();
        assert!(
            outcome
                .command
                .starts_with("PGSSLMODE=disable pg_dump --host=127.0.0.1")
        );
        assert!(outcome.command.contains("--format=custom"));
        // the password goes in the environment, never in the command (unit-tested in the adapter)
        assert!(!outcome.command.contains("PGPASSWORD"));
        assert!(outcome.bytes > 0.0);
        assert!(backup::is_pg_archive(&custom).unwrap());
        assert!(!part_path(&custom).exists());
        backup(
            &registry,
            &history,
            &config,
            Some("postgres".into()),
            "b2",
            BackupFormat::Sql,
            &plain.to_string_lossy(),
        )
        .await
        .unwrap();
        assert!(
            std::fs::read_to_string(&plain)
                .unwrap()
                .contains("CREATE TABLE public.t")
        );

        // a wrong password fails with the tool's message, and leaves no file behind
        let failed = dir.path().join("failed.dump");
        let err = backup(
            &registry,
            &history,
            &config,
            Some("errada".into()),
            "b3",
            BackupFormat::Custom,
            &failed.to_string_lossy(),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().starts_with("pg_dump: "), "{err}");
        assert!(!failed.exists() && !part_path(&failed).exists());

        // restoring always shows the command first, even with the right file
        exec(
            &registry,
            &history,
            "it",
            "DELETE FROM t WHERE id = 1; INSERT INTO t VALUES (3, 'novo')",
        )
        .await;
        let asked = confirmation(
            restore(
                &registry,
                &history,
                &config,
                Some("postgres".into()),
                "r1",
                &custom.to_string_lossy(),
                false,
            )
            .await
            .unwrap(),
        );
        assert!(asked.destructive);
        assert!(
            asked.reason.starts_with("Restaurar app.dump em postgres"),
            "{}",
            asked.reason
        );
        assert!(asked.statements[0].contains("pg_restore"));
        assert!(!asked.statements[0].contains("PGPASSWORD"));
        // nothing ran yet
        assert_eq!(names(&registry, &history, "it").await, ["ç", "novo"]);

        let restored = restore(
            &registry,
            &history,
            &config,
            Some("postgres".into()),
            "r2",
            &custom.to_string_lossy(),
            true,
        )
        .await
        .unwrap();
        assert!(matches!(restored, RestoreResponse::Restored { .. }));
        assert_eq!(names(&registry, &history, "it").await, ["a'b", "ç"]);

        // the plain SQL goes through psql, the same way
        exec(&registry, &history, "it", "DELETE FROM t").await;
        let asked = confirmation(
            restore(
                &registry,
                &history,
                &config,
                Some("postgres".into()),
                "r3",
                &plain.to_string_lossy(),
                false,
            )
            .await
            .unwrap(),
        );
        assert!(asked.statements[0].contains("psql"));
        restore(
            &registry,
            &history,
            &config,
            Some("postgres".into()),
            "r4",
            &plain.to_string_lossy(),
            true,
        )
        .await
        .unwrap();
        assert_eq!(names(&registry, &history, "it").await, ["a'b", "ç"]);

        let entries = history.search("", Some("it"), false, 50).await.unwrap();
        assert!(
            entries
                .iter()
                .any(|entry| entry.sql.starts_with("-- backup → "))
        );
        assert!(
            entries
                .iter()
                .any(|entry| entry.sql.starts_with("-- restore ← "))
        );
        assert!(!entries.iter().any(|entry| entry.sql.contains("PGPASSWORD")));

        // read-only connections refuse a restore before anything runs
        sql::disconnect(&registry, "it").await;
        config.read_only = true;
        sql::connect(&registry, &secrets, config.clone())
            .await
            .unwrap();
        assert!(matches!(
            restore(
                &registry,
                &history,
                &config,
                Some("postgres".into()),
                "r5",
                &custom.to_string_lossy(),
                true
            )
            .await,
            Err(AppError::ReadOnly(_))
        ));
        // a backup only reads: fine there
        backup(
            &registry,
            &history,
            &config,
            Some("postgres".into()),
            "b4",
            BackupFormat::Custom,
            &custom.to_string_lossy(),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn mysql_backs_up_and_restores_with_the_system_tools() {
        if !has_tools(&["mysqldump", "mysql"]) {
            return;
        }
        let (_container, config) = crate::adapters::mysql::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        sql::connect(&registry, &Password(None), config.clone())
            .await
            .unwrap();
        exec(
            &registry,
            &history,
            "my",
            "CREATE TABLE t (id int PRIMARY KEY, name text); INSERT INTO t VALUES (1, 'a''b'), (2, 'ç')",
        )
        .await;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.sql");

        let outcome = backup(
            &registry,
            &history,
            &config,
            None,
            "b1",
            BackupFormat::Sql,
            &file.to_string_lossy(),
        )
        .await
        .unwrap();
        assert!(outcome.command.starts_with("mysqldump --host=127.0.0.1"));
        assert!(
            std::fs::read_to_string(&file)
                .unwrap()
                .contains("CREATE TABLE `t`")
        );
        assert!(matches!(
            backup(
                &registry,
                &history,
                &config,
                None,
                "b2",
                BackupFormat::Custom,
                &file.to_string_lossy()
            )
            .await,
            Err(AppError::Validation(_))
        ));

        exec(&registry, &history, "my", "DELETE FROM t").await;
        let asked = confirmation(
            restore(
                &registry,
                &history,
                &config,
                None,
                "r1",
                &file.to_string_lossy(),
                false,
            )
            .await
            .unwrap(),
        );
        assert!(asked.statements[0].ends_with(&format!("--database=test < {}", file.display())));
        assert!(asked.reason.contains("não é uma transação"));
        restore(
            &registry,
            &history,
            &config,
            None,
            "r2",
            &file.to_string_lossy(),
            true,
        )
        .await
        .unwrap();
        assert_eq!(names(&registry, &history, "my").await, ["a'b", "ç"]);
    }

    #[tokio::test]
    async fn sqlite_copies_itself_with_vacuum_into_even_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.sqlite");
        let mut config = ConnectionConfig {
            id: "lite".into(),
            name: "lite".into(),
            engine: Engine::Sqlite,
            environment: Environment::Local,
            read_only: false,
            timeout_secs: 30,
            target: Target::File {
                path: path.to_string_lossy().into_owned(),
            },
            tls: crate::domain::TlsConfig {
                mode: crate::domain::TlsMode::Disable,
                ca_cert_path: None,
            },
            key_separator: None,
            ssh: None,
            group: None,
        };
        std::fs::File::create(&path).unwrap();
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        sql::connect(&registry, &Password(None), config.clone())
            .await
            .unwrap();
        exec(
            &registry,
            &history,
            "lite",
            "CREATE TABLE t (id int PRIMARY KEY, name text); INSERT INTO t VALUES (1, 'a''b'), (2, 'ç')",
        )
        .await;
        sql::disconnect(&registry, "lite").await;
        config.read_only = true;
        sql::connect(&registry, &Password(None), config.clone())
            .await
            .unwrap();

        // the copy lands in place of an older file with the same name
        let copy = dir.path().join("copia de app.sqlite");
        std::fs::write(&copy, b"antigo").unwrap();
        let outcome = backup(
            &registry,
            &history,
            &config,
            None,
            "b1",
            BackupFormat::SqliteFile,
            &copy.to_string_lossy(),
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.command,
            format!("VACUUM INTO '{}.part'", copy.display())
        );
        assert!(!part_path(&copy).exists());

        let copied = ConnectionConfig {
            id: "copia".into(),
            target: Target::File {
                path: copy.to_string_lossy().into_owned(),
            },
            ..config.clone()
        };
        sql::connect(&registry, &Password(None), copied)
            .await
            .unwrap();
        assert_eq!(names(&registry, &history, "copia").await, ["a'b", "ç"]);

        assert!(matches!(
            backup(
                &registry,
                &history,
                &config,
                None,
                "b2",
                BackupFormat::Sql,
                &copy.to_string_lossy()
            )
            .await,
            Err(AppError::Validation(_))
        ));
        // read-only refuses first; a writable SQLite says how to restore it
        assert!(matches!(
            restore(
                &registry,
                &history,
                &config,
                None,
                "r1",
                &copy.to_string_lossy(),
                false
            )
            .await,
            Err(AppError::ReadOnly(_))
        ));
        sql::disconnect(&registry, "lite").await;
        config.read_only = false;
        sql::connect(&registry, &Password(None), config.clone())
            .await
            .unwrap();
        let err = restore(
            &registry,
            &history,
            &config,
            None,
            "r2",
            &copy.to_string_lossy(),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("copiando o arquivo"), "{err}");
    }
}
