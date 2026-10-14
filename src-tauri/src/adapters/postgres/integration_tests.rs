//! Runs against a real PostgreSQL in Docker (testcontainers). One container per test.

use std::time::{Duration, Instant};

use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::ContainerAsync;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use tokio::sync::oneshot;

use super::PostgresAdapter;
use crate::adapters::dialect::Dialect;
use crate::adapters::stream::ScriptRun;
use crate::domain::{
    AppError, BrowseRequest, Cell, ConnectionConfig, Engine, Environment, Filter, FilterOp,
    RelationKind, Sort, SortDirection, Target, TlsConfig, TlsMode,
};

pub(crate) async fn start() -> (ContainerAsync<Postgres>, ConnectionConfig) {
    let container = Postgres::default()
        .start()
        .await
        .expect("docker is required for integration tests");
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let config = ConnectionConfig {
        id: "it".into(),
        name: "it".into(),
        engine: Engine::Postgres,
        environment: Environment::Local,
        read_only: false,
        timeout_secs: 30,
        target: Target::Network {
            host: "127.0.0.1".into(),
            port,
            database: "postgres".into(),
            username: "postgres".into(),
        },
        tls: TlsConfig {
            mode: TlsMode::Disable,
            ca_cert_path: None,
        },
        key_separator: None,
    };
    (container, config)
}

async fn connect(config: &ConnectionConfig, read_only: bool) -> PostgresAdapter {
    PostgresAdapter::connect(config, Some("postgres".into()), read_only)
        .await
        .unwrap()
}

async fn run(adapter: &PostgresAdapter, sql: &str) -> Result<ScriptRun, AppError> {
    adapter
        .run_script(&Dialect::Postgres.split(sql), 1000, |_| {})
        .await
}

async fn single_row(adapter: &PostgresAdapter, sql: &str) -> Vec<Cell> {
    let script = run(adapter, sql).await.unwrap();
    script.first.batch.rows.into_iter().next().unwrap()
}

#[tokio::test]
async fn values_keep_full_fidelity() {
    let (_container, config) = start().await;
    let db = connect(&config, false).await;

    let row = single_row(
        &db,
        r#"SELECT
            NULL::text, true, 9007199254740993::int8, 1.5::float8, 'NaN'::float8,
            12345678901234567890.0000000001::numeric, 'olá'::text, '\x00ff'::bytea,
            '2024-02-29'::date, '2024-01-01 10:00:00'::timestamp,
            '2024-01-01 10:00:00-03'::timestamptz, '{"id": 9007199254740993, "a": [1, 2]}'::jsonb,
            ARRAY[1, NULL, 3]::int4[], ARRAY['a,b', 'c"d']::text[],
            '(1,2)'::point, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid"#,
    )
    .await;

    let expected = vec![
        Cell::Null,
        Cell::Bool(true),
        Cell::Int("9007199254740993".into()),
        Cell::Float(1.5),
        Cell::Unknown {
            type_name: "float8".into(),
            text: "NaN".into(),
        },
        Cell::Decimal("12345678901234567890.0000000001".into()),
        Cell::Text("olá".into()),
        Cell::Bytes {
            len: 2,
            preview_hex: "00ff".into(),
        },
        Cell::Date("2024-02-29".into()),
        Cell::Timestamp {
            value: "2024-01-01 10:00:00".into(),
            tz: None,
        },
        // rendered in the session time zone (UTC)
        Cell::Timestamp {
            value: "2024-01-01 13:00:00+00".into(),
            tz: Some("UTC".into()),
        },
        // jsonb normalizes key order/spacing; the big number stays exact
        Cell::Json(r#"{"a": [1, 2], "id": 9007199254740993}"#.into()),
        Cell::Array(vec![
            Cell::Int("1".into()),
            Cell::Null,
            Cell::Int("3".into()),
        ]),
        Cell::Array(vec![Cell::Text("a,b".into()), Cell::Text("c\"d".into())]),
        Cell::Unknown {
            type_name: "point".into(),
            text: "(1,2)".into(),
        },
        Cell::Text("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11".into()),
    ];
    assert_eq!(row, expected);
}

#[tokio::test]
async fn custom_types_resolve_instead_of_crashing() {
    let (_container, config) = start().await;
    let db = connect(&config, false).await;
    run(
        &db,
        r"CREATE TYPE mood AS ENUM ('ok', 'sad');
          CREATE DOMAIN positive AS int CHECK (VALUE > 0);
          CREATE EXTENSION IF NOT EXISTS citext",
    )
    .await
    .unwrap();

    let script = run(
        &db,
        "SELECT 'sad'::mood, 5::positive, ARRAY['ok']::mood[], 'Ab'::citext",
    )
    .await
    .unwrap();

    let columns: Vec<_> = script
        .first
        .batch
        .columns
        .iter()
        .map(|c| (c.type_name.as_str(), c.editable))
        .collect();
    assert_eq!(
        columns,
        vec![
            ("mood", true),
            // result descriptions report a domain by its base type
            ("int4", true),
            ("mood[]", false),
            ("citext", false),
        ]
    );
    assert_eq!(
        script.first.batch.rows[0],
        vec![
            Cell::Text("sad".into()),
            Cell::Int("5".into()),
            Cell::Unknown {
                type_name: "mood[]".into(),
                text: "{ok}".into(),
            },
            Cell::Unknown {
                type_name: "citext".into(),
                text: "Ab".into(),
            },
        ]
    );
}

#[tokio::test]
async fn scripts_stream_batches_and_report_commands() {
    let (_container, config) = start().await;
    let db = connect(&config, false).await;

    // multiple statements on one session: the temp table survives between them
    let script = run(
        &db,
        "CREATE TEMP TABLE n AS SELECT g AS v FROM generate_series(1, 2500) g; SELECT v FROM n ORDER BY v",
    )
    .await
    .unwrap();
    assert_eq!(script.first.batch.columns[0].name, "v");
    assert_eq!(script.first.batch.rows.len(), 1000);
    assert!(script.first.batch.has_more);

    let cursor = script.cursor.expect("more rows pending");
    let second = cursor.next().await.unwrap();
    let third = cursor.next().await.unwrap();
    assert_eq!(second.batch.rows.len(), 1000);
    assert!(second.batch.has_more);
    assert_eq!(third.batch.rows.len(), 500);
    assert!(!third.batch.has_more);
    assert_eq!(third.batch.rows[499], vec![Cell::Int("2500".into())]);

    // exactly one batch: no cursor left open
    let exact = run_exact(&db, 1000).await;
    assert!(!exact.first.batch.has_more);
    assert!(exact.cursor.is_none());

    // empty SELECT keeps its header
    let empty = run(&db, "SELECT 1 AS a, 'x' AS b WHERE false")
        .await
        .unwrap();
    let names: Vec<_> = empty
        .first
        .batch
        .columns
        .iter()
        .map(|c| c.name.as_str())
        .collect();
    assert_eq!(names, vec!["a", "b"]);
    assert!(empty.first.batch.rows.is_empty());

    // utility statement: no columns, no rows
    let command = run(&db, "SET search_path TO public").await.unwrap();
    assert!(command.first.batch.columns.is_empty());
    assert!(command.first.batch.rows.is_empty());

    // an error after a full batch shows up on the next fetch
    let failing = run(&db, "SELECT 1 / (1001 - g) FROM generate_series(1, 2000) g")
        .await
        .unwrap();
    assert_eq!(failing.first.batch.rows.len(), 1000);
    let err = failing.cursor.unwrap().next().await.unwrap_err();
    assert!(err.to_string().contains("division by zero"), "{err}");

    let syntax = run(&db, "SELEC 1").await.err().unwrap();
    assert!(
        matches!(syntax, AppError::Database(ref m) if m.contains("42601")),
        "{syntax}"
    );
}

async fn run_exact(db: &PostgresAdapter, rows: u32) -> ScriptRun {
    run(db, &format!("SELECT g FROM generate_series(1, {rows}) g"))
        .await
        .unwrap()
}

#[tokio::test]
async fn read_only_blocks_writes() {
    let (_container, config) = start().await;
    let db = connect(&config, true).await;

    let err = run(&db, "CREATE TABLE t (id int)").await.err().unwrap();

    assert!(err.to_string().contains("read-only transaction"), "{err}");
}

#[tokio::test]
async fn cancel_timeout_and_abandoned_cursor_stop_the_query_server_side() {
    let (_container, mut config) = start().await;
    let db = connect(&config, false).await;

    // user cancel
    let (pid_tx, pid_rx) = oneshot::channel();
    let statements = vec!["SELECT pg_sleep(30)".to_string()];
    let running = db.run_script(&statements, 1000, |pid| {
        let _ = pid_tx.send(pid);
    });
    let canceller = async {
        let pid = pid_rx.await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        db.cancel(pid).await;
    };
    let started = Instant::now();
    let (result, ()) = tokio::join!(running, canceller);
    assert!(matches!(result, Err(AppError::Cancelled(_))));
    assert!(started.elapsed() < Duration::from_secs(10));

    // timeout cancels server-side too
    config.timeout_secs = 1;
    let short = connect(&config, false).await;
    let started = Instant::now();
    let err = run(&short, "SELECT pg_sleep(30)").await.err().unwrap();
    assert!(matches!(err, AppError::Timeout(_)), "{err}");
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(
        active_after_cancel(&db, "query = 'SELECT pg_sleep(30)'").await,
        0
    );

    // dropping a cursor mid-stream cancels instead of draining millions of rows
    let mut pid = 0_i64;
    let huge = db
        .run_script(
            &["SELECT g FROM generate_series(1, 50000000) g".to_string()],
            1000,
            |p| pid = p,
        )
        .await
        .unwrap();
    assert!(huge.cursor.is_some());
    drop(huge);
    assert_eq!(
        active_after_cancel(&db, &format!("pid = {pid}")).await,
        0,
        "backend {pid} still running after cursor was dropped"
    );
}

/// The backend handles a cancel signal on its own time: poll for up to 5s.
async fn active_after_cancel(db: &PostgresAdapter, filter: &str) -> i64 {
    let sql = format!("SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND {filter}");
    let mut active = 0;
    for _ in 0..50 {
        active = sqlx::query_scalar(sqlx::AssertSqlSafe(sql.as_str()))
            .fetch_one(&db.pool)
            .await
            .unwrap();
        if active == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    active
}

#[tokio::test]
async fn introspection_and_browsing() {
    let (_container, config) = start().await;
    let setup = connect(&config, false).await;
    run(
        &setup,
        r#"CREATE SCHEMA app;
           CREATE TABLE app.teams (id int PRIMARY KEY, name text NOT NULL);
           CREATE TABLE app.users (
             id serial PRIMARY KEY,
             team_id int REFERENCES app.teams(id),
             email text NOT NULL,
             age int,
             note text
           );
           CREATE INDEX users_email_idx ON app.users (email);
           CREATE VIEW app.adults AS SELECT * FROM app.users WHERE age >= 18;
           INSERT INTO app.teams VALUES (1, 'core');
           INSERT INTO app.users (team_id, email, age, note)
             SELECT 1, 'user' || g || '@x.com', g, CASE WHEN g % 2 = 0 THEN 'it''s \ even' END
             FROM generate_series(1, 25) g"#,
    )
    .await
    .unwrap();
    let db = connect(&config, true).await;

    let schemas = db.list_schemas().await.unwrap();
    let app = schemas.iter().find(|s| s.name == "app").unwrap();
    let relations: Vec<_> = app
        .relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        relations,
        vec![
            ("adults", RelationKind::View),
            ("teams", RelationKind::Table),
            ("users", RelationKind::Table),
        ]
    );
    assert!(
        schemas
            .iter()
            .any(|s| s.name == "public" && s.relations.is_empty())
    );
    assert!(!schemas.iter().any(|s| s.name.starts_with("pg_")));

    let structure = db.table_structure("app", "users").await.unwrap();
    let id = &structure.columns[0];
    assert_eq!((id.name.as_str(), id.data_type.as_str()), ("id", "integer"));
    assert!(id.is_primary_key && !id.nullable);
    assert!(id.default.as_deref().unwrap().starts_with("nextval"));
    assert!(structure.columns[3].nullable && !structure.columns[3].is_primary_key);
    assert!(
        structure
            .indexes
            .iter()
            .any(|i| i.name == "users_email_idx")
    );
    assert_eq!(structure.foreign_keys.len(), 1);
    assert!(
        structure.foreign_keys[0]
            .definition
            .contains("REFERENCES app.teams(id)")
    );
    let key = &structure.foreign_keys[0];
    assert_eq!(key.columns, ["team_id"]);
    assert_eq!(
        (
            key.referenced_schema.as_str(),
            key.referenced_table.as_str()
        ),
        ("app", "teams")
    );
    assert_eq!(key.referenced_columns, ["id"]);
    assert!(matches!(
        db.table_structure("app", "missing").await,
        Err(AppError::NotFound(_))
    ));

    let completion = db.completion_tables().await.unwrap();
    let users = completion.iter().find(|t| t.table == "users").unwrap();
    assert_eq!(users.columns, vec!["id", "team_id", "email", "age", "note"]);

    let page = |page, filters, sort| BrowseRequest {
        schema: "app".into(),
        table: "users".into(),
        filters,
        sort,
        page,
        page_size: 10,
    };

    // default order = primary key; 25 rows → pages of 10, 10, 5
    let first = db.browse(&page(0, vec![], None)).await.unwrap();
    assert_eq!(first.rows.len(), 10);
    assert!(first.has_more);
    assert_eq!(first.rows[0][0], Cell::Int("1".into()));
    let last = db.browse(&page(2, vec![], None)).await.unwrap();
    assert_eq!(last.rows.len(), 5);
    assert!(!last.has_more);

    let sorted = db
        .browse(&page(
            0,
            vec![],
            Some(Sort {
                column: "age".into(),
                direction: SortDirection::Desc,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(sorted.rows[0][3], Cell::Int("25".into()));

    let filter = |column: &str, op, value: Option<&str>| Filter {
        column: column.into(),
        op,
        value: value.map(str::to_string),
    };
    let eq = db
        .browse(&page(0, vec![filter("age", FilterOp::Eq, Some("7"))], None))
        .await
        .unwrap();
    assert_eq!(eq.rows.len(), 1);
    let like = db
        .browse(&page(
            0,
            vec![filter("email", FilterOp::Like, Some("user1%"))],
            None,
        ))
        .await
        .unwrap();
    assert_eq!(like.rows.len(), 10); // user1, user10..user19
    let nulls = db
        .browse(&page(0, vec![filter("note", FilterOp::IsNull, None)], None))
        .await
        .unwrap();
    assert_eq!(nulls.rows.len(), 10);
    assert!(nulls.has_more); // 13 odd rows
    // quotes and backslashes round-trip through the escaped literal
    let escaped = db
        .browse(&page(
            0,
            vec![filter("note", FilterOp::Eq, Some(r"it's \ even"))],
            None,
        ))
        .await
        .unwrap();
    assert_eq!(escaped.rows.len(), 10);
    assert!(escaped.has_more);
    // injection attempt is just a value that matches nothing
    let injection = db
        .browse(&page(
            0,
            vec![filter(
                "email",
                FilterOp::Eq,
                Some("x'; DROP TABLE app.users; --"),
            )],
            None,
        ))
        .await
        .unwrap();
    assert!(injection.rows.is_empty());
    assert_eq!(injection.columns.len(), 5); // header even with no rows
    assert_eq!(
        db.browse(&page(0, vec![], None)).await.unwrap().rows.len(),
        10
    );

    // views have no primary key: still browsable
    let mut view = page(0, vec![], None);
    view.table = "adults".into();
    assert_eq!(db.browse(&view).await.unwrap().rows.len(), 8);

    let mut missing = page(0, vec![], None);
    missing.table = "nope".into();
    assert!(matches!(
        db.browse(&missing).await,
        Err(AppError::Database(_))
    ));
}
