use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use futures_util::{StreamExt, TryStreamExt, stream};

use crate::adapters::SqlConnection;
use crate::adapters::mongo::MongoAdapter;
use crate::adapters::redis::RedisAdapter;
use crate::adapters::sql_builder;
use crate::adapters::ssh::SshTunnel;
use crate::domain::{
    AppError, ApplyResponse, BrowseRequest, Cell, CompletionTable, Confirmation, ConnectionConfig,
    DiagramTable, Engine, Environment, FilterOp, RelationKind, RowBatch, RowChange, RunResponse,
    SchemaInfo, ScriptOutcome, StatementResult, TableChanges, TableStructure, Target,
};
use crate::registry::{Live, OpenConnection, Registry};
use crate::storage::history::{HistoryStore, NewHistoryEntry};
use crate::storage::secrets::SecretStore;
use crate::use_cases::connections::sentinel_secret_id;
use crate::use_cases::guard;

/// Rows per batch in the SQL editor (initial result and each `fetch_more`).
pub const EDITOR_BATCH_SIZE: usize = 1000;
pub const MAX_PAGE_SIZE: u32 = 1000;

pub async fn connect(
    registry: &Registry,
    secrets: &dyn SecretStore,
    config: ConnectionConfig,
) -> Result<(), AppError> {
    if registry.is_connected(&config.id) {
        return Ok(());
    }
    // a file database has no password; MongoDB's secret may be a whole connection string
    let secret = match config.engine {
        Engine::Sqlite => None,
        _ => secrets.get(&config.id)?,
    };
    let sentinel_secret = match config.target {
        Target::RedisSentinel { .. } => secrets.get(&sentinel_secret_id(&config.id))?,
        _ => None,
    };
    let (live, tunnel) = open(&config, secret, sentinel_secret).await?;
    registry.insert_connection(
        &config.id,
        OpenConnection {
            live,
            name: config.name,
            environment: config.environment,
            read_only: config.read_only,
            tunnel,
        },
    );
    Ok(())
}

/// Each adapter's connect reaches the server (handshake, ping or first pooled
/// connection), so a wrong host or password fails here. With SSH, the adapter
/// connects to the tunnel's local port instead of the database's host.
async fn open(
    config: &ConnectionConfig,
    secret: Option<String>,
    sentinel_secret: Option<String>,
) -> Result<(Live, Option<SshTunnel>), AppError> {
    let mut config = config.clone();
    let tunnel = match (&config.ssh, &mut config.target) {
        (Some(ssh), Target::Network { host, port, .. }) => {
            let tunnel = SshTunnel::open(ssh, host, *port).await?;
            *host = "127.0.0.1".to_string();
            *port = tunnel.local_port;
            Some(tunnel)
        }
        _ => None,
    };
    let config = &config;
    let live = match config.engine {
        Engine::Mongo => Live::Mongo(MongoAdapter::connect(config, secret).await?),
        Engine::Redis => Live::Redis(Box::new(
            RedisAdapter::connect(config, secret, sentinel_secret).await?,
        )),
        _ => Live::Sql(SqlConnection::connect(config, secret, config.read_only).await?),
    };
    Ok((live, tunnel))
}

/// Connects with a configuration that may not be saved and closes at once:
/// nothing is registered, stored or written to the keychain.
pub async fn test_connection(
    config: &ConnectionConfig,
    secret: Option<String>,
    sentinel_secret: Option<String>,
) -> Result<(), AppError> {
    let (live, _tunnel) = open(config, secret, sentinel_secret).await?;
    live.close().await;
    Ok(())
}

pub async fn disconnect(registry: &Registry, connection_id: &str) {
    if let Some(connection) = registry.remove_connection(connection_id) {
        connection.close().await;
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
        .sql()?
        .table_structure(schema, table)
        .await
}

/// Every table of the schema with its columns and outgoing foreign keys.
pub async fn schema_diagram(
    registry: &Registry,
    connection_id: &str,
    schema: &str,
) -> Result<Vec<DiagramTable>, AppError> {
    let connection = registry.connection(connection_id)?;
    let sql = connection.sql()?;
    let tables: Vec<String> = sql
        .list_schemas()
        .await?
        .into_iter()
        .find(|info| info.name == schema)
        .ok_or_else(|| AppError::not_found(&format!("schema {schema}")))?
        .relations
        .into_iter()
        .filter(|relation| relation.kind == RelationKind::Table)
        .map(|relation| relation.name)
        .collect();
    // ponytail: one catalog round trip per table; a schema-wide query per engine if
    // big schemas get slow
    stream::iter(tables)
        .map(|name| async move {
            let structure = sql.table_structure(schema, &name).await?;
            Ok::<_, AppError>(DiagramTable {
                name,
                columns: structure.columns,
                foreign_keys: structure.foreign_keys,
            })
        })
        .buffered(8)
        .try_collect()
        .await
}

pub async fn completion_tables(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<CompletionTable>, AppError> {
    registry
        .connection(connection_id)?
        .sql()?
        .completion_tables()
        .await
}

pub async fn browse(
    registry: &Registry,
    connection_id: &str,
    request: BrowseRequest,
) -> Result<RowBatch, AppError> {
    validate_browse(&request)?;
    registry
        .connection(connection_id)?
        .sql()?
        .browse(&request)
        .await
}

pub(crate) fn validate_browse(request: &BrowseRequest) -> Result<(), AppError> {
    if request.page_size == 0 || request.page_size > MAX_PAGE_SIZE {
        return Err(AppError::validation(format!(
            "tamanho de página deve ser entre 1 e {MAX_PAGE_SIZE}"
        )));
    }
    for filter in &request.filters {
        let value = filter.value.as_deref();
        let missing = match filter.op {
            FilterOp::In => value.is_none_or(|list| sql_builder::in_items(list).next().is_none()),
            op => op.needs_value() && value.is_none(),
        };
        if missing {
            return Err(AppError::validation(format!(
                "informe um valor para filtrar {}",
                filter.column
            )));
        }
    }
    Ok(())
}

/// Splits the script and asks for confirmation when it is destructive (or writes on
/// prod). Otherwise runs it, keeping the last statement's rows streaming under
/// `run_id`, which is also the cursor id for `fetch_more`/`close_cursor`.
pub async fn run_script(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    sql: &str,
    confirmed: bool,
) -> Result<RunResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let dialect = connection.sql()?.dialect();
    let statements = dialect.split(sql);
    if statements.is_empty() {
        return Err(AppError::validation("nenhum comando para executar"));
    }
    if !confirmed {
        let confirmation = guard::confirmation_for(
            &statements,
            dialect,
            connection.environment,
            connection.read_only,
        );
        if let Some(confirmation) = confirmation {
            return Ok(RunResponse::NeedsConfirmation { confirmation });
        }
    }
    // a re-run under the same id replaces the previous result
    registry.remove_cursor(run_id);

    let started = Instant::now();
    let result = connection
        .sql()?
        .run_script(&statements, EDITOR_BATCH_SIZE, |pid| {
            registry.start_run(run_id, connection.clone(), pid)
        })
        .await;
    registry.finish_run(run_id);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        &connection,
        sql,
        duration_ms,
        result.as_ref().err(),
    )
    .await;
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

    Ok(RunResponse::Executed {
        outcome: ScriptOutcome {
            statement_count: u32::try_from(statements.len()).unwrap_or(u32::MAX),
            duration_ms,
            result,
        },
    })
}

/// Applies staged grid edits in one transaction. Rows are identified by the whole
/// primary key; tables without one are not editable. On prod the generated SQL is
/// returned for confirmation first.
/// Rows of a table as INSERT statements, in the connection's own SQL dialect.
pub fn copy_as_insert(
    registry: &Registry,
    connection_id: &str,
    schema: &str,
    table: &str,
    columns: &[String],
    rows: &[Vec<Cell>],
) -> Result<String, AppError> {
    let dialect = registry.connection(connection_id)?.sql()?.dialect();
    sql_builder::insert_sql(dialect, schema, table, columns, rows)
}

pub async fn apply_changes(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    changes: TableChanges,
    confirmed: bool,
) -> Result<ApplyResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    if changes.changes.is_empty() {
        return Err(AppError::validation("nenhuma alteração para salvar"));
    }
    let primary_key = connection
        .sql()?
        .primary_key(&changes.schema, &changes.table)
        .await?;
    validate_keys(&changes.changes, &primary_key)?;

    let statements = changes
        .changes
        .iter()
        .map(|change| {
            sql_builder::change_sql(
                connection.sql()?.dialect(),
                &changes.schema,
                &changes.table,
                change,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    if connection.environment == Environment::Prod && !confirmed {
        return Ok(ApplyResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: "Conexão de produção: confira as alterações antes de salvar".to_string(),
                statements,
                destructive: false,
            },
        });
    }

    let started = Instant::now();
    let result = connection.sql()?.apply(&statements).await;
    let sql = format!("{};", statements.join(";\n"));
    record(
        history,
        connection_id,
        &connection,
        &sql,
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    Ok(ApplyResponse::Applied {
        rows_changed: result?,
    })
}

fn validate_keys(changes: &[RowChange], primary_key: &[String]) -> Result<(), AppError> {
    if primary_key.is_empty() {
        return Err(AppError::validation(
            "tabela sem chave primária não pode ser editada",
        ));
    }
    let expected: BTreeSet<&str> = primary_key.iter().map(String::as_str).collect();
    for change in changes {
        let key = match change {
            RowChange::Update { key, .. } | RowChange::Delete { key } => key,
            RowChange::Insert { .. } => continue,
        };
        let given: BTreeSet<&str> = key.iter().map(|k| k.column.as_str()).collect();
        if given != expected || given.len() != key.len() {
            return Err(AppError::validation(
                "a linha precisa ser identificada pela chave primária completa",
            ));
        }
    }
    Ok(())
}

/// Best effort: failing to write history must not fail the query itself.
pub(crate) async fn record(
    history: &HistoryStore,
    connection_id: &str,
    connection: &OpenConnection,
    sql: &str,
    duration_ms: u32,
    error: Option<&AppError>,
) {
    let _ = history
        .record(NewHistoryEntry {
            connection_id,
            connection_name: &connection.name,
            sql,
            duration_ms,
            error: error.map(ToString::to_string),
        })
        .await;
}

pub(crate) fn elapsed_ms(started: Instant) -> u32 {
    u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX)
}

pub async fn search_history(
    history: &HistoryStore,
    text: &str,
    connection_id: Option<&str>,
    starred_only: bool,
) -> Result<Vec<crate::domain::HistoryEntry>, AppError> {
    history
        .search(text.trim(), connection_id, starred_only, HISTORY_PAGE)
        .await
}

const HISTORY_PAGE: u32 = 200;

/// A cancel is repeated this many times, this far apart, while the run lasts.
const CANCEL_ATTEMPTS: u32 = 20;
const CANCEL_RETRY: Duration = Duration::from_millis(100);

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
        Some((connection, session)) => match &connection.live {
            Live::Sql(sql) => {
                // the session is registered just before the query reaches the server: a
                // cancel landing in that gap finds the backend idle and is lost, so it is
                // sent again until the run ends (bounded; the timeout covers the rest)
                for _ in 0..CANCEL_ATTEMPTS {
                    sql.cancel(session).await;
                    tokio::time::sleep(CANCEL_RETRY).await;
                    if registry
                        .running(run_id)
                        .is_none_or(|(_, current)| current != session)
                    {
                        break;
                    }
                }
                Ok(())
            }
            // MongoDB operations are tagged with the run id
            Live::Mongo(mongo) => mongo.kill(run_id).await,
            // Redis commands never register a run: they only have the timeout
            Live::Redis(_) => Ok(()),
        },
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
    fn keys_must_be_the_full_primary_key() {
        use crate::domain::{Cell, KeyValue};
        let key = |columns: &[&str]| {
            columns
                .iter()
                .map(|c| KeyValue {
                    column: c.to_string(),
                    value: Cell::Int("1".into()),
                })
                .collect::<Vec<_>>()
        };
        let pk = vec!["id".to_string(), "tenant".to_string()];
        let delete = |columns: &[&str]| vec![RowChange::Delete { key: key(columns) }];

        assert!(validate_keys(&delete(&["tenant", "id"]), &pk).is_ok());
        assert!(validate_keys(&[RowChange::Insert { values: vec![] }], &pk).is_ok());
        assert!(validate_keys(&delete(&["id"]), &pk).is_err());
        assert!(validate_keys(&delete(&["id", "tenant", "name"]), &pk).is_err());
        assert!(validate_keys(&delete(&["id", "id"]), &pk).is_err());
        assert!(validate_keys(&delete(&["id"]), &[]).is_err());
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
        let empty_list = Filter {
            column: "id".into(),
            op: FilterOp::In,
            value: Some(" , ".into()),
        };
        assert!(validate_browse(&request(100, vec![empty_list])).is_err());
    }
}

#[cfg(test)]
mod integration_tests {
    use std::time::Duration;

    use super::*;
    use crate::adapters::postgres::integration_tests::start;
    use crate::domain::{Cell, ColumnValue, KeyValue, Target, TlsConfig, TlsMode};

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

    fn executed(response: RunResponse) -> ScriptOutcome {
        match response {
            RunResponse::Executed { outcome } => outcome,
            RunResponse::NeedsConfirmation { confirmation } => {
                panic!("unexpected confirmation: {confirmation:?}")
            }
        }
    }

    async fn exec(
        registry: &Registry,
        history: &HistoryStore,
        run_id: &str,
        sql: &str,
    ) -> ScriptOutcome {
        executed(
            run_script(registry, history, "it", run_id, sql, false)
                .await
                .unwrap(),
        )
    }

    #[tokio::test]
    async fn scripts_stream_cancel_and_disconnect_through_the_registry() {
        let (_container, config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        // idempotent
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        assert!(!list_schemas(&registry, "it").await.unwrap().is_empty());

        // the last statement streams under a cursor named after the run
        let outcome = exec(
            &registry,
            &history,
            "r1",
            "SELECT 1; SELECT g FROM generate_series(1, 1500) g",
        )
        .await;
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
        let small = exec(&registry, &history, "r2", "SELECT 1").await;
        assert!(matches!(
            small.result,
            StatementResult::Rows {
                cursor_id: None,
                ..
            }
        ));

        let command = exec(&registry, &history, "r3", "SET search_path TO public").await;
        assert_eq!(
            command.result,
            StatementResult::Command { rows_affected: 0 }
        );

        assert!(matches!(
            run_script(&registry, &history, "it", "r4", "-- nothing to run", false).await,
            Err(AppError::Validation(_))
        ));

        // cancel while running
        let running = run_script(
            &registry,
            &history,
            "it",
            "r5",
            "SELECT pg_sleep(30)",
            false,
        );
        // cancelled about the moment the run registers, possibly before pg_sleep reaches
        // the server: the gap where a single cancel finds the backend idle. The wait is
        // generous because instrumented CI builds are slow to get there
        let cancel = async {
            let deadline = Instant::now() + Duration::from_secs(20);
            while registry.running("r5").is_none() && Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            cancel_run(&registry, "r5").await.unwrap();
        };
        let (result, ()) = tokio::join!(running, cancel);
        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert!(registry.running("r5").is_none());
        // cancelling a finished run is a no-op
        cancel_run(&registry, "r5").await.unwrap();

        // every run lands in the history, failures included
        let entries = history.search("", Some("it"), false, 50).await.unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].sql, "SELECT pg_sleep(30)");
        assert_eq!(entries[0].error.as_deref(), Some("query cancelada"));
        assert!(entries[1].success);

        // closing a cursor releases it
        exec(
            &registry,
            &history,
            "r6",
            "SELECT g FROM generate_series(1, 5000) g",
        )
        .await;
        close_cursor(&registry, "r6");
        assert!(matches!(
            fetch_more(&registry, "r6").await,
            Err(AppError::NotFound(_))
        ));

        // disconnect with an open cursor must not hang: closing the pool waits for
        // the cursor's checked-out connection
        exec(
            &registry,
            &history,
            "r7",
            "SELECT g FROM generate_series(1, 5000000) g",
        )
        .await;
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

    #[tokio::test]
    async fn writes_need_confirmation_when_destructive_or_on_prod() {
        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();

        exec(&registry, &history, "w1", "CREATE TABLE t (id int PRIMARY KEY, name text); INSERT INTO t VALUES (1, 'a'), (2, 'b')").await;

        // destructive: nothing runs until confirmed
        let response = run_script(&registry, &history, "it", "w2", "DELETE FROM t", false)
            .await
            .unwrap();
        let RunResponse::NeedsConfirmation { confirmation } = response else {
            panic!("expected confirmation");
        };
        assert_eq!(confirmation.reason, "Comando destrutivo: DELETE sem WHERE");
        assert_eq!(confirmation.statements, vec!["DELETE FROM t"]);
        let still_there = exec(&registry, &history, "w3", "SELECT count(*) FROM t").await;
        assert!(
            matches!(still_there.result, StatementResult::Rows { batch, .. } if batch.rows[0][0] == Cell::Int("2".into()))
        );
        // not recorded: it never ran
        assert!(
            history
                .search("DELETE FROM t", None, false, 10)
                .await
                .unwrap()
                .is_empty()
        );

        let confirmed = executed(
            run_script(&registry, &history, "it", "w4", "DELETE FROM t", true)
                .await
                .unwrap(),
        );
        assert_eq!(
            confirmed.result,
            StatementResult::Command { rows_affected: 2 }
        );

        // on prod every write asks, reads do not
        disconnect(&registry, "it").await;
        config.environment = Environment::Prod;
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        assert!(matches!(
            run_script(
                &registry,
                &history,
                "it",
                "w5",
                "INSERT INTO t VALUES (3, 'c')",
                false
            )
            .await
            .unwrap(),
            RunResponse::NeedsConfirmation { .. }
        ));
        exec(&registry, &history, "w6", "SELECT * FROM t").await;

        // read-only connections: the database itself refuses, no confirmation step
        disconnect(&registry, "it").await;
        config.read_only = true;
        connect(&registry, &ContainerPassword, config)
            .await
            .unwrap();
        let err = run_script(&registry, &history, "it", "w7", "DROP TABLE t", false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("read-only"), "{err}");
    }

    #[tokio::test]
    async fn staged_changes_apply_in_one_transaction() {
        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        exec(
            &registry,
            &history,
            "s1",
            r"CREATE TYPE mood AS ENUM ('ok', 'sad');
              CREATE TABLE people (id int, tenant text, name text, mood mood, PRIMARY KEY (id, tenant));
              CREATE TABLE logs (msg text);
              INSERT INTO people VALUES (1, 'x', 'Ana', 'ok'), (2, 'x', 'Bia', 'sad')",
        )
        .await;

        let key = |id: &str| {
            vec![
                KeyValue {
                    column: "tenant".into(),
                    value: Cell::Text("x".into()),
                },
                KeyValue {
                    column: "id".into(),
                    value: Cell::Int(id.into()),
                },
            ]
        };
        let value = |column: &str, value: Option<&str>| ColumnValue {
            column: column.into(),
            value: value.map(str::to_string),
        };
        let changes = |list: Vec<RowChange>| TableChanges {
            schema: "public".into(),
            table: "people".into(),
            changes: list,
        };

        let applied = apply_changes(
            &registry,
            &history,
            "it",
            changes(vec![
                RowChange::Update {
                    key: key("1"),
                    values: vec![
                        value("name", Some("Ana O'Neil")),
                        value("mood", Some("sad")),
                    ],
                },
                RowChange::Delete { key: key("2") },
                RowChange::Insert {
                    values: vec![
                        value("id", Some("3")),
                        value("tenant", Some("x")),
                        value("name", None),
                        value("mood", Some("ok")),
                    ],
                },
            ]),
            false,
        )
        .await
        .unwrap();
        assert_eq!(applied, ApplyResponse::Applied { rows_changed: 3 });

        // enum columns are editable text now that custom types are resolved
        let page = browse(
            &registry,
            "it",
            BrowseRequest {
                schema: "public".into(),
                table: "people".into(),
                filters: vec![],
                sort: None,
                page: 0,
                page_size: 10,
            },
        )
        .await
        .unwrap();
        assert_eq!(page.columns[3].type_name, "mood");
        assert!(page.columns[3].editable);
        assert_eq!(
            page.rows,
            vec![
                vec![
                    Cell::Int("1".into()),
                    Cell::Text("x".into()),
                    Cell::Text("Ana O'Neil".into()),
                    Cell::Text("sad".into())
                ],
                vec![
                    Cell::Int("3".into()),
                    Cell::Text("x".into()),
                    Cell::Null,
                    Cell::Text("ok".into())
                ],
            ]
        );
        let recorded = history.search("UPDATE", None, false, 10).await.unwrap();
        assert_eq!(recorded.len(), 1);
        assert!(
            recorded[0]
                .sql
                .contains("DELETE FROM \"public\".\"people\"")
        );

        // a row that no longer matches rolls the whole batch back
        let conflict = apply_changes(
            &registry,
            &history,
            "it",
            changes(vec![
                RowChange::Update {
                    key: key("1"),
                    values: vec![value("name", Some("changed"))],
                },
                RowChange::Delete { key: key("2") },
            ]),
            false,
        )
        .await
        .unwrap_err();
        assert!(matches!(conflict, AppError::Conflict(_)));
        let after = exec(
            &registry,
            &history,
            "s2",
            "SELECT name FROM people WHERE id = 1",
        )
        .await;
        assert!(
            matches!(after.result, StatementResult::Rows { batch, .. } if batch.rows[0][0] == Cell::Text("Ana O'Neil".into()))
        );

        // a database error also rolls back and is reported
        let bad = apply_changes(
            &registry,
            &history,
            "it",
            changes(vec![RowChange::Update {
                key: key("1"),
                values: vec![value("mood", Some("happy"))],
            }]),
            false,
        )
        .await
        .unwrap_err();
        assert!(
            bad.to_string().contains("invalid input value for enum"),
            "{bad}"
        );

        // keys must be the full primary key; tables without one are not editable
        let partial = apply_changes(
            &registry,
            &history,
            "it",
            changes(vec![RowChange::Delete {
                key: vec![KeyValue {
                    column: "id".into(),
                    value: Cell::Int("1".into()),
                }],
            }]),
            false,
        )
        .await
        .unwrap_err();
        assert!(matches!(partial, AppError::Validation(_)));
        let no_pk = apply_changes(
            &registry,
            &history,
            "it",
            TableChanges {
                schema: "public".into(),
                table: "logs".into(),
                changes: vec![RowChange::Insert {
                    values: vec![value("msg", Some("hi"))],
                }],
            },
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(
            no_pk.to_string(),
            "tabela sem chave primária não pode ser editada"
        );

        // prod returns the generated SQL for confirmation, then applies it
        disconnect(&registry, "it").await;
        config.environment = Environment::Prod;
        connect(&registry, &ContainerPassword, config.clone())
            .await
            .unwrap();
        let delete_three = || changes(vec![RowChange::Delete { key: key("3") }]);
        let response = apply_changes(&registry, &history, "it", delete_three(), false)
            .await
            .unwrap();
        let ApplyResponse::NeedsConfirmation { confirmation } = response else {
            panic!("expected confirmation");
        };
        assert_eq!(
            confirmation.statements,
            vec![r#"DELETE FROM "public"."people" WHERE "tenant" = 'x' AND "id" = '3'"#]
        );
        assert_eq!(
            apply_changes(&registry, &history, "it", delete_three(), true)
                .await
                .unwrap(),
            ApplyResponse::Applied { rows_changed: 1 }
        );

        // read-only connections refuse before touching the database
        disconnect(&registry, "it").await;
        config.read_only = true;
        connect(&registry, &ContainerPassword, config)
            .await
            .unwrap();
        assert!(matches!(
            apply_changes(&registry, &history, "it", delete_three(), true).await,
            Err(AppError::ReadOnly(_))
        ));
    }

    /// The whole path through the use case for a non-Postgres engine: enum dispatch,
    /// the SQLite dialect in the guard and splitter, no keychain lookup.
    #[tokio::test]
    async fn sqlite_through_the_use_cases() {
        struct NoKeychain;
        impl SecretStore for NoKeychain {
            fn get(&self, _: &str) -> Result<Option<String>, AppError> {
                panic!("SQLite must not ask the keychain")
            }
            fn set(&self, _: &str, _: &str) -> Result<(), AppError> {
                Ok(())
            }
            fn delete(&self, _: &str) -> Result<(), AppError> {
                Ok(())
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        std::fs::File::create(&path).unwrap();
        let config = ConnectionConfig {
            id: "lite".into(),
            name: "lite".into(),
            engine: Engine::Sqlite,
            environment: Environment::Local,
            read_only: false,
            timeout_secs: 30,
            target: Target::File {
                path: path.to_string_lossy().into_owned(),
            },
            tls: TlsConfig {
                mode: TlsMode::Disable,
                ca_cert_path: None,
            },
            key_separator: None,
            ssh: None,
        };
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        connect(&registry, &NoKeychain, config).await.unwrap();

        let run = |run_id: &'static str, sql: &'static str, confirmed: bool| {
            run_script(&registry, &history, "lite", run_id, sql, confirmed)
        };
        executed(
            run(
                "l1",
                "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1, 'a'), (2, 'b')",
                false,
            )
            .await
            .unwrap(),
        );
        assert!(matches!(
            run("l2", "DELETE FROM t", false).await.unwrap(),
            RunResponse::NeedsConfirmation { .. }
        ));

        let applied = apply_changes(
            &registry,
            &history,
            "lite",
            TableChanges {
                schema: "main".into(),
                table: "t".into(),
                changes: vec![RowChange::Update {
                    key: vec![KeyValue {
                        column: "id".into(),
                        value: Cell::Int("2".into()),
                    }],
                    values: vec![ColumnValue {
                        column: "name".into(),
                        value: Some("B".into()),
                    }],
                }],
            },
            false,
        )
        .await
        .unwrap();
        assert_eq!(applied, ApplyResponse::Applied { rows_changed: 1 });

        let schemas = list_schemas(&registry, "lite").await.unwrap();
        assert_eq!(schemas[0].name, "main");
        let rows = executed(
            run("l3", "SELECT name FROM t ORDER BY id", false)
                .await
                .unwrap(),
        );
        assert!(matches!(
            rows.result,
            StatementResult::Rows { batch, .. }
                if batch.rows == vec![vec![Cell::Text("a".into())], vec![Cell::Text("B".into())]]
        ));
    }
}
