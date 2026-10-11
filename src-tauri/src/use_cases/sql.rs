use std::time::Instant;

use crate::adapters::postgres::{PostgresAdapter, split_statements};
use crate::domain::{
    AppError, BrowseRequest, CompletionTable, ConnectionConfig, Engine, FilterOp, RowBatch,
    SchemaInfo, ScriptOutcome, StatementResult, TableStructure,
};
use crate::registry::Registry;
use crate::storage::secrets::SecretStore;

/// Rows per batch in the SQL editor (initial result and each `fetch_more`).
pub const EDITOR_BATCH_SIZE: usize = 1000;
pub const MAX_PAGE_SIZE: u32 = 1000;

/// ponytail: M1 opens every connection read-only, whatever its flag. M2 lifts this
/// once destructive-statement detection and prod confirmation exist.
const FORCE_READ_ONLY: bool = true;

pub async fn connect(
    registry: &Registry,
    secrets: &dyn SecretStore,
    config: ConnectionConfig,
) -> Result<(), AppError> {
    if registry.is_connected(&config.id) {
        return Ok(());
    }
    if config.engine != Engine::Postgres {
        return Err(AppError::validation(
            "por enquanto só PostgreSQL conecta (MySQL/SQLite no M3, MongoDB no M4, Redis no M5)",
        ));
    }
    let password = secrets.get(&config.id)?;
    let adapter =
        PostgresAdapter::connect(&config, password, config.read_only || FORCE_READ_ONLY).await?;
    registry.insert_connection(&config.id, adapter);
    Ok(())
}

pub async fn disconnect(registry: &Registry, connection_id: &str) {
    if let Some(adapter) = registry.remove_connection(connection_id) {
        adapter.close().await;
    }
}

pub async fn list_schemas(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<SchemaInfo>, AppError> {
    registry.connection(connection_id)?.list_schemas().await
}

pub async fn table_structure(
    registry: &Registry,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<TableStructure, AppError> {
    registry
        .connection(connection_id)?
        .table_structure(schema, table)
        .await
}

pub async fn completion_tables(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<CompletionTable>, AppError> {
    registry
        .connection(connection_id)?
        .completion_tables()
        .await
}

pub async fn browse(
    registry: &Registry,
    connection_id: &str,
    request: BrowseRequest,
) -> Result<RowBatch, AppError> {
    validate_browse(&request)?;
    registry.connection(connection_id)?.browse(&request).await
}

fn validate_browse(request: &BrowseRequest) -> Result<(), AppError> {
    if request.page_size == 0 || request.page_size > MAX_PAGE_SIZE {
        return Err(AppError::validation(format!(
            "tamanho de página deve ser entre 1 e {MAX_PAGE_SIZE}"
        )));
    }
    for filter in &request.filters {
        let needs_value = matches!(filter.op, FilterOp::Eq | FilterOp::Like);
        if needs_value && filter.value.is_none() {
            return Err(AppError::validation(format!(
                "informe um valor para filtrar {}",
                filter.column
            )));
        }
    }
    Ok(())
}

/// Splits the script, runs it and keeps the last statement's rows streaming under
/// `run_id`, which is also the cursor id for `fetch_more`/`close_cursor`.
pub async fn run_script(
    registry: &Registry,
    connection_id: &str,
    run_id: &str,
    sql: &str,
) -> Result<ScriptOutcome, AppError> {
    let statements = split_statements(sql);
    if statements.is_empty() {
        return Err(AppError::validation("nenhum comando para executar"));
    }
    let adapter = registry.connection(connection_id)?;
    // a re-run under the same id replaces the previous result
    registry.remove_cursor(run_id);

    let started = Instant::now();
    let result = adapter
        .run_script(&statements, EDITOR_BATCH_SIZE, |pid| {
            registry.start_run(run_id, adapter.clone(), pid)
        })
        .await;
    registry.finish_run(run_id);
    let run = result?;

    let has_cursor = run.cursor.is_some();
    if let Some(cursor) = run.cursor {
        registry.insert_cursor(run_id, connection_id, cursor);
    }

    let first = run.first;
    let is_command = first.batch.columns.is_empty() && first.batch.rows.is_empty();
    let result = if is_command {
        StatementResult::Command {
            rows_affected: u32::try_from(first.rows_affected.unwrap_or(0)).unwrap_or(u32::MAX),
        }
    } else {
        StatementResult::Rows {
            batch: first.batch,
            cursor_id: has_cursor.then(|| run_id.to_string()),
        }
    };

    Ok(ScriptOutcome {
        statement_count: u32::try_from(statements.len()).unwrap_or(u32::MAX),
        duration_ms: u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX),
        result,
    })
}

/// Next batch of an open cursor; the cursor is released once exhausted or on error.
pub async fn fetch_more(registry: &Registry, cursor_id: &str) -> Result<RowBatch, AppError> {
    let cursor = registry.cursor(cursor_id)?;
    let read = cursor.next().await;
    if !read.as_ref().is_ok_and(|r| r.batch.has_more) {
        registry.remove_cursor(cursor_id);
    }
    Ok(read?.batch)
}

pub fn close_cursor(registry: &Registry, cursor_id: &str) {
    registry.remove_cursor(cursor_id);
}

/// Cancels a script that is still running (no-op if it already finished).
pub async fn cancel_run(registry: &Registry, run_id: &str) -> Result<(), AppError> {
    match registry.running(run_id) {
        Some((adapter, pid)) => adapter.cancel_backend(pid).await,
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Filter;

    fn request(page_size: u32, filters: Vec<Filter>) -> BrowseRequest {
        BrowseRequest {
            schema: "public".into(),
            table: "t".into(),
            filters,
            sort: None,
            page: 0,
            page_size,
        }
    }

    #[test]
    fn browse_validation() {
        let missing_value = Filter {
            column: "name".into(),
            op: FilterOp::Eq,
            value: None,
        };
        let is_null = Filter {
            column: "name".into(),
            op: FilterOp::IsNull,
            value: None,
        };

        assert!(validate_browse(&request(100, vec![is_null])).is_ok());
        assert!(validate_browse(&request(MAX_PAGE_SIZE, vec![])).is_ok());
        assert_eq!(
            validate_browse(&request(0, vec![]))
                .unwrap_err()
                .to_string(),
            "tamanho de página deve ser entre 1 e 1000"
        );
        assert!(validate_browse(&request(MAX_PAGE_SIZE + 1, vec![])).is_err());
        assert_eq!(
            validate_browse(&request(100, vec![missing_value]))
                .unwrap_err()
                .to_string(),
            "informe um valor para filtrar name"
        );
    }
}

#[cfg(test)]
mod integration_tests {
    use std::time::Duration;

    use super::*;
    use crate::adapters::postgres::integration_tests::start;
    use crate::domain::{Environment, Target, TlsConfig, TlsMode};

    struct ContainerPassword;

    impl SecretStore for ContainerPassword {
        fn get(&self, _: &str) -> Result<Option<String>, AppError> {
            Ok(Some("postgres".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AppError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), AppError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn only_postgres_connects_for_now() {
        let config = ConnectionConfig {
            id: "r".into(),
            name: "r".into(),
            engine: Engine::Redis,
            environment: Environment::Local,
            read_only: false,
            timeout_secs: 30,
            target: Target::Network {
                host: "localhost".into(),
                port: 6379,
                database: "0".into(),
                username: String::new(),
            },
            tls: TlsConfig {
                mode: TlsMode::Disable,
                ca_cert_path: None,
            },
            key_separator: Some(":".into()),
        };

        let err = connect(&Registry::default(), &ContainerPassword, config)
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn scripts_stream_cancel_and_disconnect_through_the_registry() {
        let (_container, config) = start().await;
        let registry = Registry::default();
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        // idempotent
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        assert!(!list_schemas(&registry, "it").await.unwrap().is_empty());

        // M1 forces read-only even though this connection is not flagged
        assert!(!config.read_only);
        let err = run_script(&registry, "it", "r0", "CREATE TABLE x (id int)")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("read-only"), "{err}");

        // the last statement streams under a cursor named after the run
        let outcome = run_script(
            &registry,
            "it",
            "r1",
            "SELECT 1; SELECT g FROM generate_series(1, 1500) g",
        )
        .await
        .unwrap();
        assert_eq!(outcome.statement_count, 2);
        let StatementResult::Rows { batch, cursor_id } = outcome.result else {
            panic!("expected rows");
        };
        assert_eq!(batch.rows.len(), 1000);
        assert_eq!(cursor_id.as_deref(), Some("r1"));
        let rest = fetch_more(&registry, "r1").await.unwrap();
        assert_eq!(rest.rows.len(), 500);
        assert!(!rest.has_more);
        // exhausted cursors are released
        assert!(matches!(
            fetch_more(&registry, "r1").await,
            Err(AppError::NotFound(_))
        ));

        // a complete result has no cursor
        let small = run_script(&registry, "it", "r2", "SELECT 1").await.unwrap();
        assert!(matches!(
            small.result,
            StatementResult::Rows {
                cursor_id: None,
                ..
            }
        ));

        let command = run_script(&registry, "it", "r3", "SET search_path TO public")
            .await
            .unwrap();
        assert_eq!(
            command.result,
            StatementResult::Command { rows_affected: 0 }
        );

        assert!(matches!(
            run_script(&registry, "it", "r4", "-- nothing to run").await,
            Err(AppError::Validation(_))
        ));

        // cancel while running
        let running = run_script(&registry, "it", "r5", "SELECT pg_sleep(30)");
        let cancel = async {
            for _ in 0..100 {
                if registry.running("r5").is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            cancel_run(&registry, "r5").await.unwrap();
        };
        let (result, ()) = tokio::join!(running, cancel);
        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert!(registry.running("r5").is_none());
        // cancelling a finished run is a no-op
        cancel_run(&registry, "r5").await.unwrap();

        // closing a cursor releases it
        run_script(
            &registry,
            "it",
            "r6",
            "SELECT g FROM generate_series(1, 5000) g",
        )
        .await
        .unwrap();
        close_cursor(&registry, "r6");
        assert!(matches!(
            fetch_more(&registry, "r6").await,
            Err(AppError::NotFound(_))
        ));

        // disconnect with an open cursor must not hang: closing the pool waits for
        // the cursor's checked-out connection
        run_script(
            &registry,
            "it",
            "r7",
            "SELECT g FROM generate_series(1, 5000000) g",
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(10), disconnect(&registry, "it"))
            .await
            .expect("disconnect hung with an open cursor");
        assert!(matches!(
            list_schemas(&registry, "it").await,
            Err(AppError::NotConnected(_))
        ));
        assert!(matches!(
            fetch_more(&registry, "r7").await,
            Err(AppError::NotFound(_))
        ));
    }
}
