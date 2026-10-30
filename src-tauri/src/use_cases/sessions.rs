//! Active sessions of a server, and ending a query or a session.
//!
//! Ending is a write: refused on read-only connections, confirmed on prod showing the
//! exact command. Redis' `CLIENT KILL` is confirmed everywhere, as in the console.

use std::time::Instant;

use mongodb::bson::Bson;

use crate::adapters::SqlConnection;
use crate::domain::{
    AppError, Cell, Confirmation, Environment, KillAction, KillResponse, RowBatch, SessionInfo,
    SessionList,
};
use crate::registry::{Live, Registry};
use crate::storage::history::HistoryStore;
use crate::use_cases::sql::{elapsed_ms, record};

/// Client sessions with their time in the current state; the listing's own first.
const POSTGRES_SESSIONS: &str = "SELECT pid, usename::text, datname::text, state,
       floor(extract(epoch FROM clock_timestamp() - COALESCE(state_change, backend_start)))::bigint,
       NULLIF(concat_ws(' · ', host(client_addr) || ':' || client_port, NULLIF(application_name, '')), ''),
       query,
       pid = pg_backend_pid()
FROM pg_stat_activity
WHERE backend_type = 'client backend'
ORDER BY pid = pg_backend_pid() DESC, state = 'active' DESC, pid";

/// Without the PROCESS privilege MySQL lists only the user's own threads.
const MYSQL_SESSIONS: &str =
    "SELECT ID, USER, DB, CONCAT_WS(' · ', COMMAND, NULLIF(STATE, '')), TIME, HOST, INFO,
       ID = CONNECTION_ID()
FROM information_schema.PROCESSLIST
ORDER BY ID = CONNECTION_ID() DESC, ID";

const MONGO_SESSIONS: &str = r#"db.getSiblingDB("admin").aggregate([{ "$currentOp": { "allUsers": true, "idleConnections": false } }])"#;

const REDIS_SESSIONS: &str = "CLIENT LIST\nSLOWLOG GET 128";

/// Rows read from the server's session list.
const MAX_SESSIONS: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionEngine {
    Postgres,
    Mysql,
    Mongo,
    Redis,
}

fn engine_of(live: &Live) -> Result<SessionEngine, AppError> {
    match live {
        Live::Sql(SqlConnection::Postgres(_)) => Ok(SessionEngine::Postgres),
        Live::Sql(SqlConnection::Mysql(_)) => Ok(SessionEngine::Mysql),
        Live::Sql(SqlConnection::Sqlite(_)) => Err(AppError::validation(
            "o SQLite não tem sessões: o arquivo é aberto direto por quem o usa",
        )),
        Live::Mongo(_) => Ok(SessionEngine::Mongo),
        Live::Redis(_) => Ok(SessionEngine::Redis),
    }
}

fn actions(engine: SessionEngine) -> Vec<KillAction> {
    match engine {
        SessionEngine::Postgres | SessionEngine::Mysql => {
            vec![KillAction::CancelQuery, KillAction::EndSession]
        }
        // killOp stops the operation; the client's connection stays
        SessionEngine::Mongo => vec![KillAction::CancelQuery],
        // Redis cannot stop a running command, only close the client
        SessionEngine::Redis => vec![KillAction::EndSession],
    }
}

pub async fn list(registry: &Registry, connection_id: &str) -> Result<SessionList, AppError> {
    let connection = registry.connection(connection_id)?;
    let engine = engine_of(&connection.live)?;
    let (statement, sessions, slow_log) = match &connection.live {
        Live::Sql(sql) => {
            let statement = if engine == SessionEngine::Postgres {
                POSTGRES_SESSIONS
            } else {
                MYSQL_SESSIONS
            };
            let run = sql
                .run_script(&[statement.to_string()], MAX_SESSIONS, |_| {})
                .await?;
            (statement, sql_sessions(&run.first.batch), Vec::new())
        }
        Live::Mongo(mongo) => (MONGO_SESSIONS, mongo.sessions().await?, Vec::new()),
        Live::Redis(redis) => {
            let (sessions, slow_log) = redis.clients().await?;
            (REDIS_SESSIONS, sessions, slow_log)
        }
    };
    Ok(SessionList {
        statement: statement.to_string(),
        sessions,
        actions: actions(engine),
        slow_log,
    })
}

/// Columns in the order of the SQL listings above.
fn sql_sessions(batch: &RowBatch) -> Vec<SessionInfo> {
    batch
        .rows
        .iter()
        .map(|row| {
            let text = |index: usize| row.get(index).and_then(cell_text);
            SessionInfo {
                id: text(0).unwrap_or_default(),
                user: text(1),
                database: text(2),
                state: text(3),
                seconds: text(4)
                    .and_then(|seconds| seconds.parse::<i64>().ok())
                    .map(|seconds| u32::try_from(seconds.max(0)).unwrap_or(u32::MAX)),
                client: text(5),
                query: text(6),
                own: matches!(row.get(7), Some(Cell::Bool(true)))
                    || matches!(row.get(7), Some(Cell::Int(own)) if own == "1"),
            }
        })
        .collect()
}

fn cell_text(cell: &Cell) -> Option<String> {
    match cell {
        Cell::Null => None,
        Cell::Bool(value) => Some(value.to_string()),
        Cell::Float(value) => Some(value.to_string()),
        Cell::Int(text)
        | Cell::Decimal(text)
        | Cell::Text(text)
        | Cell::Date(text)
        | Cell::Json(text)
        | Cell::Unknown { text, .. } => Some(text.clone()),
        Cell::Timestamp { value, .. } => Some(value.clone()),
        Cell::Bytes { .. } | Cell::Array(_) => None,
    }
}

/// A Mongo operation id: a number, or "shard:number" on a sharded cluster.
fn mongo_opid(id: &str) -> Result<Bson, AppError> {
    if let Ok(number) = id.parse::<i64>() {
        return Ok(i32::try_from(number).map_or(Bson::Int64(number), Bson::Int32));
    }
    let valid_shard = id.rsplit_once(':').is_some_and(|(shard, number)| {
        !shard.is_empty()
            && shard
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
            && number.parse::<u64>().is_ok()
    });
    if valid_shard {
        Ok(Bson::String(id.to_string()))
    } else {
        Err(invalid_id(id))
    }
}

fn invalid_id(id: &str) -> AppError {
    AppError::validation(format!("id de sessão inválido: {id}"))
}

/// The exact command that ends `id`; ids are checked, never pasted as given.
fn kill_statement(engine: SessionEngine, id: &str, action: KillAction) -> Result<String, AppError> {
    if !actions(engine).contains(&action) {
        return Err(AppError::validation(match action {
            KillAction::CancelQuery => "esta engine não cancela só a query: encerre a sessão",
            KillAction::EndSession => "esta engine não encerra a sessão: cancele a operação",
        }));
    }
    if engine == SessionEngine::Mongo {
        let op = match mongo_opid(id)? {
            Bson::String(text) => serde_json::to_string(&text)?,
            number => number.to_string(),
        };
        return Ok(format!(r#"db.adminCommand({{ "killOp": 1, "op": {op} }})"#));
    }
    let id: u64 = id.parse().map_err(|_| invalid_id(id))?;
    Ok(match (engine, action) {
        (SessionEngine::Postgres, KillAction::CancelQuery) => {
            format!("SELECT pg_cancel_backend({id})")
        }
        (SessionEngine::Postgres, KillAction::EndSession) => {
            format!("SELECT pg_terminate_backend({id})")
        }
        (SessionEngine::Mysql, KillAction::CancelQuery) => format!("KILL QUERY {id}"),
        (SessionEngine::Mysql, KillAction::EndSession) => format!("KILL {id}"),
        _ => format!("CLIENT KILL ID {id}"),
    })
}

pub async fn kill(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    session_id: &str,
    action: KillAction,
    confirmed: bool,
) -> Result<KillResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let engine = engine_of(&connection.live)?;
    let statement = kill_statement(engine, session_id, action)?;
    let is_redis = engine == SessionEngine::Redis;
    if !confirmed && (is_redis || connection.environment == Environment::Prod) {
        return Ok(KillResponse::NeedsConfirmation {
            confirmation: Confirmation {
                marks: Vec::new(),
                reason: if is_redis {
                    "Comando destrutivo: derruba conexões de clientes".to_string()
                } else {
                    "Conexão de produção: confirme antes de encerrar".to_string()
                },
                statements: vec![statement],
                destructive: is_redis,
            },
        });
    }

    let started = Instant::now();
    let result = run_kill(&connection.live, engine, session_id, &statement).await;
    record(
        history,
        connection_id,
        &connection,
        &statement,
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    result.map(|()| KillResponse::Done)
}

async fn run_kill(
    live: &Live,
    engine: SessionEngine,
    id: &str,
    statement: &str,
) -> Result<(), AppError> {
    let gone = || AppError::not_found(&format!("sessão {id} (já terminou?)"));
    match live {
        Live::Sql(sql) => {
            let run = sql.run_script(&[statement.to_string()], 1, |_| {}).await?;
            // pg_cancel_backend/pg_terminate_backend answer false for a pid that is gone
            let answer = run.first.batch.rows.first().and_then(|row| row.first());
            if engine == SessionEngine::Postgres && answer != Some(&Cell::Bool(true)) {
                return Err(gone());
            }
            Ok(())
        }
        Live::Mongo(mongo) => mongo.kill_op(mongo_opid(id)?).await,
        Live::Redis(redis) => {
            let id = id.parse().map_err(|_| invalid_id(id))?;
            match redis.kill_client(id).await? {
                0 => Err(gone()),
                _ => Ok(()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ResultColumn;

    #[test]
    fn kill_statements_are_built_from_checked_ids() {
        use KillAction::{CancelQuery, EndSession};
        use SessionEngine::{Mongo, Mysql, Postgres, Redis};
        let cases = [
            (Postgres, "12", CancelQuery, "SELECT pg_cancel_backend(12)"),
            (
                Postgres,
                "12",
                EndSession,
                "SELECT pg_terminate_backend(12)",
            ),
            (Mysql, "7", CancelQuery, "KILL QUERY 7"),
            (Mysql, "7", EndSession, "KILL 7"),
            (Redis, "3", EndSession, "CLIENT KILL ID 3"),
            (
                Mongo,
                "42",
                CancelQuery,
                r#"db.adminCommand({ "killOp": 1, "op": 42 })"#,
            ),
            (
                Mongo,
                "shard01:42",
                CancelQuery,
                r#"db.adminCommand({ "killOp": 1, "op": "shard01:42" })"#,
            ),
        ];
        for (engine, id, action, expected) in cases {
            assert_eq!(kill_statement(engine, id, action).unwrap(), expected);
        }
        for (engine, id, action) in [
            (Postgres, "1; DROP TABLE x", CancelQuery),
            (Mysql, "-1", EndSession),
            (Redis, "1 TYPE normal", EndSession),
            (Mongo, "x\":1", CancelQuery),
            (Mongo, ":1", CancelQuery),
            // what the engine cannot do
            (Redis, "1", CancelQuery),
            (Mongo, "1", EndSession),
        ] {
            assert!(kill_statement(engine, id, action).is_err(), "{id}");
        }
        assert_eq!(
            mongo_opid("5000000000").unwrap(),
            Bson::Int64(5_000_000_000)
        );
        assert_eq!(mongo_opid("5").unwrap(), Bson::Int32(5));
    }

    #[test]
    fn sql_rows_become_sessions() {
        let column = |name: &str| ResultColumn {
            name: name.into(),
            type_name: "text".into(),
            editable: false,
        };
        let batch = RowBatch {
            columns: [
                "id", "user", "db", "state", "secs", "client", "query", "own",
            ]
            .map(column)
            .to_vec(),
            rows: vec![
                vec![
                    Cell::Int("10".into()),
                    Cell::Text("app".into()),
                    Cell::Text("shop".into()),
                    Cell::Text("active".into()),
                    Cell::Int("75".into()),
                    Cell::Text("10.0.0.1:5000 · ordo".into()),
                    Cell::Text("SELECT 1".into()),
                    Cell::Bool(true),
                ],
                vec![
                    Cell::Int("11".into()),
                    Cell::Null,
                    Cell::Null,
                    Cell::Text("Sleep".into()),
                    Cell::Int("-1".into()),
                    Cell::Null,
                    Cell::Null,
                    // MySQL's comparison is a number
                    Cell::Int("0".into()),
                ],
            ],
            has_more: false,
        };
        let sessions = sql_sessions(&batch);
        assert_eq!(sessions[0].id, "10");
        assert!(sessions[0].own);
        assert_eq!(sessions[0].seconds, Some(75));
        assert_eq!(sessions[0].client.as_deref(), Some("10.0.0.1:5000 · ordo"));
        assert!(!sessions[1].own);
        assert_eq!(sessions[1].user, None);
        assert_eq!(sessions[1].seconds, Some(0));
    }
}

#[cfg(test)]
mod integration_tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;
    use crate::adapters::mongo::MongoAdapter;
    use crate::adapters::mysql::MysqlAdapter;
    use crate::adapters::postgres::PostgresAdapter;
    use crate::adapters::redis::RedisAdapter;
    use crate::adapters::stream::ScriptRun;
    use crate::adapters::{mongo, mysql, postgres, redis};
    use crate::registry::OpenConnection;

    fn register(registry: &Registry, live: Live, environment: Environment, read_only: bool) {
        registry.insert_connection(
            "it",
            OpenConnection {
                live,
                name: "it".into(),
                environment,
                read_only,
                tunnel: None,
            },
        );
    }

    fn done(response: KillResponse) {
        assert_eq!(response, KillResponse::Done);
    }

    #[tokio::test]
    async fn postgres_lists_sessions_and_cancels_a_running_query() {
        let (_container, config) = postgres::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let app = PostgresAdapter::connect(&config, Some("postgres".into()), false)
            .await
            .unwrap();
        register(
            &registry,
            Live::Sql(SqlConnection::Postgres(app)),
            Environment::Local,
            false,
        );

        // another client, sleeping
        let other = Arc::new(
            PostgresAdapter::connect(&config, Some("postgres".into()), false)
                .await
                .unwrap(),
        );
        let sleeper = other.clone();
        let sleeping = tokio::spawn(async move {
            sleeper
                .run_script(&["SELECT pg_sleep(30)".to_string()], 1, |_| {})
                .await
                .map(|_: ScriptRun| ())
        });
        let deadline = Instant::now() + Duration::from_secs(20);
        let target = loop {
            let listing = list(&registry, "it").await.unwrap();
            assert!(listing.sessions[0].own, "{:?}", listing.sessions);
            if let Some(session) = listing
                .sessions
                .iter()
                .find(|session| session.query.as_deref() == Some("SELECT pg_sleep(30)"))
            {
                break session.clone();
            }
            assert!(
                Instant::now() < deadline,
                "the sleeping session never showed up"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        assert_eq!(target.state.as_deref(), Some("active"));
        assert!(target.client.unwrap().contains("ordo"));

        done(
            kill(
                &registry,
                &history,
                "it",
                &target.id,
                KillAction::CancelQuery,
                false,
            )
            .await
            .unwrap(),
        );
        assert!(matches!(
            sleeping.await.unwrap(),
            Err(AppError::Cancelled(_))
        ));
        let entries = history.search("", Some("it"), false, 10).await.unwrap();
        assert_eq!(
            entries[0].sql,
            format!("SELECT pg_cancel_backend({})", target.id)
        );

        // a pid that is gone says so
        assert!(matches!(
            kill(
                &registry,
                &history,
                "it",
                "999999",
                KillAction::EndSession,
                false
            )
            .await,
            Err(AppError::NotFound(_))
        ));

        // prod asks first, with the exact command; read-only refuses before that
        let app = PostgresAdapter::connect(&config, Some("postgres".into()), false)
            .await
            .unwrap();
        register(
            &registry,
            Live::Sql(SqlConnection::Postgres(app)),
            Environment::Prod,
            false,
        );
        let KillResponse::NeedsConfirmation { confirmation } = kill(
            &registry,
            &history,
            "it",
            "1",
            KillAction::EndSession,
            false,
        )
        .await
        .unwrap() else {
            panic!("prod must confirm");
        };
        assert_eq!(confirmation.statements, ["SELECT pg_terminate_backend(1)"]);
        let app = PostgresAdapter::connect(&config, Some("postgres".into()), true)
            .await
            .unwrap();
        register(
            &registry,
            Live::Sql(SqlConnection::Postgres(app)),
            Environment::Local,
            true,
        );
        assert!(matches!(
            kill(&registry, &history, "it", "1", KillAction::EndSession, true).await,
            Err(AppError::ReadOnly(_))
        ));
        // listing is a read: fine on read-only
        assert!(list(&registry, "it").await.unwrap().sessions[0].own);
    }

    #[tokio::test]
    async fn mysql_lists_threads_and_kills_a_query() {
        let (_container, config) = mysql::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let app = MysqlAdapter::connect(&config, None, false).await.unwrap();
        register(
            &registry,
            Live::Sql(SqlConnection::Mysql(app)),
            Environment::Local,
            false,
        );

        let other = Arc::new(MysqlAdapter::connect(&config, None, false).await.unwrap());
        let sleeper = other.clone();
        let sleeping = tokio::spawn(async move {
            sleeper
                .run_script(&["SELECT SLEEP(30)".to_string()], 1, |_| {})
                .await
                .map(|run: ScriptRun| run.first.batch.rows)
        });
        let deadline = Instant::now() + Duration::from_secs(20);
        let target = loop {
            let listing = list(&registry, "it").await.unwrap();
            assert!(listing.sessions[0].own);
            assert_eq!(
                listing.actions,
                [KillAction::CancelQuery, KillAction::EndSession]
            );
            if let Some(session) = listing
                .sessions
                .iter()
                .find(|session| session.query.as_deref() == Some("SELECT SLEEP(30)"))
            {
                break session.clone();
            }
            assert!(
                Instant::now() < deadline,
                "the sleeping thread never showed up"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        };

        done(
            kill(
                &registry,
                &history,
                "it",
                &target.id,
                KillAction::CancelQuery,
                false,
            )
            .await
            .unwrap(),
        );
        // KILL QUERY on SLEEP() makes it return 1 instead of failing
        let rows = sleeping.await.unwrap();
        assert!(
            matches!(&rows, Err(AppError::Cancelled(_)))
                || rows
                    .as_ref()
                    .is_ok_and(|rows| rows[0][0] == Cell::Int("1".into())),
            "{rows:?}"
        );
    }

    #[tokio::test]
    async fn mongo_lists_operations_and_marks_its_own() {
        let (_container, config) = mongo::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let app = MongoAdapter::connect(&config, None).await.unwrap();
        register(&registry, Live::Mongo(app), Environment::Local, false);

        let listing = list(&registry, "it").await.unwrap();
        assert_eq!(listing.actions, [KillAction::CancelQuery]);
        let own = listing.sessions.iter().find(|session| session.own).unwrap();
        assert!(own.query.as_deref().unwrap().contains("$currentOp"));
        // killOp of an operation that is gone is not an error for the server
        done(
            kill(
                &registry,
                &history,
                "it",
                "2147483000",
                KillAction::CancelQuery,
                false,
            )
            .await
            .unwrap(),
        );
    }

    #[tokio::test]
    async fn redis_lists_clients_and_slowlog_and_kills_a_client() {
        let (_container, config) = redis::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let app = RedisAdapter::connect(&config, None, None).await.unwrap();
        redis::integration_tests::run(&app, 0, "CONFIG SET slowlog-log-slower-than 0").await;
        redis::integration_tests::run(&app, 0, "SET slow 1").await;
        register(
            &registry,
            Live::Redis(Box::new(app)),
            Environment::Local,
            false,
        );

        // a second client: a connection of its own
        let other = RedisAdapter::connect(&config, None, None).await.unwrap();
        let other_id = redis::integration_tests::run(&other, 0, "CLIENT ID").await;
        let other_id = other_id.trim_start_matches("(integer) ").to_string();

        let listing = list(&registry, "it").await.unwrap();
        assert_eq!(
            listing
                .sessions
                .iter()
                .filter(|session| session.own)
                .count(),
            1
        );
        assert!(
            listing
                .sessions
                .iter()
                .any(|session| session.id == other_id)
        );
        assert!(
            listing
                .slow_log
                .iter()
                .any(|entry| entry.command == "SET slow 1"),
            "{:?}",
            listing.slow_log
        );

        // CLIENT KILL is confirmed even off prod, as in the console
        let KillResponse::NeedsConfirmation { confirmation } = kill(
            &registry,
            &history,
            "it",
            &other_id,
            KillAction::EndSession,
            false,
        )
        .await
        .unwrap() else {
            panic!("CLIENT KILL must confirm");
        };
        assert!(confirmation.destructive);
        assert_eq!(
            confirmation.statements,
            [format!("CLIENT KILL ID {other_id}")]
        );
        done(
            kill(
                &registry,
                &history,
                "it",
                &other_id,
                KillAction::EndSession,
                true,
            )
            .await
            .unwrap(),
        );
        let listing = list(&registry, "it").await.unwrap();
        assert!(
            !listing
                .sessions
                .iter()
                .any(|session| session.id == other_id)
        );
        assert!(matches!(
            kill(
                &registry,
                &history,
                "it",
                &other_id,
                KillAction::EndSession,
                true
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }
}
