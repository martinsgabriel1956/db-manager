//! Runs against a real MySQL 8 in Docker (testcontainers). One container per test.

use std::time::{Duration, Instant};

use testcontainers_modules::mysql::Mysql;
use testcontainers_modules::testcontainers::ContainerAsync;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use tokio::sync::oneshot;

use super::MysqlAdapter;
use crate::adapters::sql_builder;
use crate::adapters::stream::ScriptRun;
use crate::domain::{
    AppError, BrowseRequest, Cell, ColumnValue, ConnectionConfig, Engine, Environment, Filter,
    FilterOp, KeyValue, RelationKind, RowChange, Sort, SortDirection, Target, TlsConfig, TlsMode,
};

async fn start() -> (ContainerAsync<Mysql>, ConnectionConfig) {
    let container = Mysql::default()
        .start()
        .await
        .expect("docker is required for integration tests");
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let config = ConnectionConfig {
        id: "my".into(),
        name: "my".into(),
        engine: Engine::Mysql,
        environment: Environment::Local,
        read_only: false,
        timeout_secs: 30,
        target: Target::Network {
            host: "127.0.0.1".into(),
            port,
            database: "test".into(),
            username: "root".into(),
        },
        tls: TlsConfig {
            mode: TlsMode::Disable,
            ca_cert_path: None,
        },
        key_separator: None,
        ssh: None,
    };
    (container, config)
}

async fn connect(config: &ConnectionConfig, read_only: bool) -> MysqlAdapter {
    MysqlAdapter::connect(config, None, read_only)
        .await
        .unwrap()
}

async fn run(db: &MysqlAdapter, sql: &str) -> Result<ScriptRun, AppError> {
    db.run_script(&db.dialect().split(sql), 1000, |_| {}).await
}

#[tokio::test]
async fn values_types_and_introspection() {
    let (_container, config) = start().await;
    let db = connect(&config, false).await;
    run(
        &db,
        r#"CREATE TABLE teams (id INT PRIMARY KEY, name VARCHAR(50) NOT NULL);
           CREATE TABLE people (
             id BIGINT UNSIGNED PRIMARY KEY,
             team_id INT,
             name VARCHAR(100) NOT NULL,
             balance DECIMAL(20, 4),
             score DOUBLE,
             active BOOLEAN,
             born DATE,
             seen DATETIME,
             updated TIMESTAMP NULL,
             mood ENUM('ok', 'sad'),
             profile JSON,
             avatar VARBINARY(16),
             note TEXT,
             UNIQUE KEY people_name (name),
             CONSTRAINT people_team FOREIGN KEY (team_id) REFERENCES teams (id)
           );
           CREATE VIEW sad_people AS SELECT * FROM people WHERE mood = 'sad';
           INSERT INTO teams VALUES (1, 'core');
           INSERT INTO people VALUES
             (18446744073709551615, 1, 'Ana', 1234.5678, 1.5, TRUE, '2000-02-29',
              '2024-01-01 10:00:00', '2024-01-01 13:00:00', 'sad',
              '{"id": 9007199254740993}', X'00FF', NULL)"#,
    )
    .await
    .unwrap();

    let script = run(&db, "SELECT * FROM people").await.unwrap();
    let types: Vec<_> = script
        .first
        .batch
        .columns
        .iter()
        .map(|c| (c.type_name.as_str(), c.editable))
        .collect();
    assert_eq!(types[0], ("bigint unsigned", true));
    assert_eq!(types[11], ("varbinary", false));
    assert_eq!(
        script.first.batch.rows[0],
        vec![
            Cell::Int("18446744073709551615".into()),
            Cell::Int("1".into()),
            Cell::Text("Ana".into()),
            Cell::Decimal("1234.5678".into()),
            Cell::Float(1.5),
            Cell::Int("1".into()),
            Cell::Date("2000-02-29".into()),
            Cell::Timestamp {
                value: "2024-01-01 10:00:00".into(),
                tz: None,
            },
            Cell::Timestamp {
                value: "2024-01-01 13:00:00".into(),
                tz: Some("UTC".into()),
            },
            Cell::Text("sad".into()),
            Cell::Json(r#"{"id": 9007199254740993}"#.into()),
            Cell::Bytes {
                len: 2,
                preview_hex: "00ff".into(),
            },
            Cell::Null,
        ]
    );

    let schemas = db.list_schemas().await.unwrap();
    let test = schemas.iter().find(|s| s.name == "test").unwrap();
    let relations: Vec<_> = test
        .relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        relations,
        vec![
            ("people", RelationKind::Table),
            ("sad_people", RelationKind::View),
            ("teams", RelationKind::Table),
        ]
    );
    assert!(!schemas.iter().any(|s| s.name == "mysql" || s.name == "sys"));

    let structure = db.table_structure("test", "people").await.unwrap();
    assert_eq!(structure.columns[0].data_type, "bigint unsigned");
    assert!(structure.columns[0].is_primary_key && !structure.columns[0].nullable);
    assert!(structure.columns[1].nullable);
    // active BOOLEAN, mood ENUM: the grid offers their values
    assert_eq!(structure.columns[5].options, ["1", "0"]);
    assert_eq!(structure.columns[9].options, ["ok", "sad"]);
    assert!(structure.columns[2].options.is_empty());
    let definitions: Vec<_> = structure
        .indexes
        .iter()
        .map(|i| i.definition.as_str())
        .collect();
    assert!(definitions.contains(&"PRIMARY KEY (id)"));
    assert!(definitions.contains(&"UNIQUE INDEX (name)"));
    assert_eq!(
        structure.foreign_keys[0].definition,
        "FOREIGN KEY (team_id) REFERENCES test.teams (id)"
    );
    let key = &structure.foreign_keys[0];
    assert_eq!(key.columns, ["team_id"]);
    assert_eq!(
        (
            key.referenced_schema.as_str(),
            key.referenced_table.as_str()
        ),
        ("test", "teams")
    );
    assert_eq!(key.referenced_columns, ["id"]);
    assert_eq!(db.primary_key("test", "people").await.unwrap(), vec!["id"]);
    // TABLE_ROWS is an estimate; a view has none
    assert!(db.estimate_rows("test", "teams").await.unwrap().is_some());
    assert_eq!(db.estimate_rows("test", "sad_people").await.unwrap(), None);
    let count = crate::adapters::sql_builder::count_sql(
        db.dialect(),
        &BrowseRequest {
            schema: "test".into(),
            table: "people".into(),
            filters: vec![],
            sort: None,
            page: 0,
            page_size: 1,
        },
    )
    .unwrap();
    let rows = run(&db, &count).await.unwrap().first.batch.rows;
    assert_eq!(rows, vec![vec![Cell::Int("1".into())]]);
    assert!(matches!(
        db.table_structure("test", "missing").await,
        Err(AppError::NotFound(_))
    ));

    let completion = db.completion_tables().await.unwrap();
    let teams = completion.iter().find(|t| t.table == "teams").unwrap();
    assert_eq!(teams.columns, vec!["id", "name"]);
}

#[tokio::test]
async fn browsing_streaming_cancel_and_edits() {
    let (_container, mut config) = start().await;
    let db = connect(&config, false).await;
    run(
        &db,
        r"CREATE TABLE items (id INT PRIMARY KEY, name VARCHAR(50), note TEXT);
          INSERT INTO items
          WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 25)
          SELECT n, CONCAT('item', n), IF(n % 2 = 0, 'it''s \\ even', NULL) FROM seq",
    )
    .await
    .unwrap();

    let page = |page, filters, sort| BrowseRequest {
        schema: "test".into(),
        table: "items".into(),
        filters,
        sort,
        page,
        page_size: 10,
    };
    let filter = |column: &str, op, value: Option<&str>| Filter {
        column: column.into(),
        op,
        value: value.map(str::to_string),
    };

    let first = db.browse(&page(0, vec![], None)).await.unwrap();
    assert_eq!((first.rows.len(), first.has_more), (10, true));
    assert_eq!(first.rows[0][0], Cell::Int("1".into()));
    let last = db.browse(&page(2, vec![], None)).await.unwrap();
    assert_eq!((last.rows.len(), last.has_more), (5, false));
    let sorted = db
        .browse(&page(
            0,
            vec![],
            Some(Sort {
                column: "id".into(),
                direction: SortDirection::Desc,
            }),
        ))
        .await
        .unwrap();
    assert_eq!(sorted.rows[0][0], Cell::Int("25".into()));
    let like = db
        .browse(&page(
            0,
            vec![filter("name", FilterOp::Like, Some("item1%"))],
            None,
        ))
        .await
        .unwrap();
    assert_eq!(like.rows.len(), 10);
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
    let injection = db
        .browse(&page(
            0,
            vec![filter(
                "name",
                FilterOp::Eq,
                Some("x'; DROP TABLE items; --"),
            )],
            None,
        ))
        .await
        .unwrap();
    assert!(injection.rows.is_empty());
    assert_eq!(injection.columns.len(), 3);

    // streaming the last statement of a script
    let script = run(
        &db,
        "SET SESSION cte_max_recursion_depth = 5000; WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2500) SELECT n FROM seq",
    )
    .await
    .unwrap();
    assert_eq!(script.first.batch.rows.len(), 1000);
    let cursor = script.cursor.unwrap();
    assert_eq!(cursor.next().await.unwrap().batch.rows.len(), 1000);
    let tail = cursor.next().await.unwrap();
    assert_eq!((tail.batch.rows.len(), tail.batch.has_more), (500, false));

    let command = run(&db, "UPDATE items SET note = 'x' WHERE id <= 3")
        .await
        .unwrap();
    assert_eq!(command.first.rows_affected, Some(3));

    // cancel through KILL QUERY
    let (id_tx, id_rx) = oneshot::channel();
    let statements = vec!["SELECT SLEEP(30)".to_string()];
    let running = db.run_script(&statements, 1000, |id| {
        let _ = id_tx.send(id);
    });
    let canceller = async {
        let Ok(id) = id_rx.await else { return };
        tokio::time::sleep(Duration::from_millis(300)).await;
        db.cancel(id).await;
    };
    let started = Instant::now();
    let (result, ()) = tokio::join!(running, canceller);
    // SLEEP() returns 1 when interrupted instead of failing
    let interrupted = result.map_err(|e| e.to_string()).unwrap();
    assert_eq!(interrupted.first.batch.rows[0][0], Cell::Int("1".into()));
    assert!(started.elapsed() < Duration::from_secs(10));

    // a killed long query surfaces as cancelled
    config.timeout_secs = 1;
    let short = connect(&config, false).await;
    let started = Instant::now();
    let err = run(
        &short,
        "SELECT COUNT(*) FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c",
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(err, AppError::Timeout(_)), "{err}");
    assert!(started.elapsed() < Duration::from_secs(10));

    // staged edits: one transaction, exactly one row each
    let key = |id: &str| {
        vec![KeyValue {
            column: "id".into(),
            value: Cell::Int(id.into()),
        }]
    };
    let set = |value: &str| {
        vec![ColumnValue {
            column: "name".into(),
            value: Some(value.into()),
        }]
    };
    let sql = |change: RowChange| {
        sql_builder::change_sql(db.dialect(), "test", "items", &change).unwrap()
    };
    let applied = db
        .apply(&[
            sql(RowChange::Update {
                key: key("1"),
                values: set(r"O'Neil \o/"),
            }),
            sql(RowChange::Delete { key: key("2") }),
            sql(RowChange::Insert {
                values: vec![ColumnValue {
                    column: "id".into(),
                    value: Some("100".into()),
                }],
            }),
            // same value as before: matched (FOUND_ROWS), not a conflict
            sql(RowChange::Update {
                key: key("3"),
                values: set("item3"),
            }),
        ])
        .await
        .unwrap();
    assert_eq!(applied, 4);
    let check = run(&db, "SELECT name FROM items WHERE id = 1")
        .await
        .unwrap();
    assert_eq!(
        check.first.batch.rows[0][0],
        Cell::Text(r"O'Neil \o/".into())
    );
    let conflict = db
        .apply(&[
            sql(RowChange::Update {
                key: key("4"),
                values: set("changed"),
            }),
            sql(RowChange::Delete { key: key("2") }),
        ])
        .await
        .unwrap_err();
    assert!(matches!(conflict, AppError::Conflict(_)));
    let unchanged = run(&db, "SELECT name FROM items WHERE id = 4")
        .await
        .unwrap();
    assert_eq!(unchanged.first.batch.rows[0][0], Cell::Text("item4".into()));
}

#[tokio::test]
async fn read_only_sessions_refuse_writes() {
    let (_container, config) = start().await;
    let setup = connect(&config, false).await;
    run(&setup, "CREATE TABLE t (id INT PRIMARY KEY)")
        .await
        .unwrap();
    let db = connect(&config, true).await;

    let err = run(&db, "INSERT INTO t VALUES (1)").await.err().unwrap();

    assert!(err.to_string().contains("READ ONLY"), "{err}");
}

#[tokio::test]
async fn no_backslash_escapes_mode_is_detected() {
    let (_container, config) = start().await;
    let root = connect(&config, false).await;
    run(
        &root,
        "SET GLOBAL sql_mode = CONCAT(@@GLOBAL.sql_mode, ',NO_BACKSLASH_ESCAPES')",
    )
    .await
    .unwrap();
    run(&root, "CREATE TABLE paths (id INT PRIMARY KEY, path TEXT)")
        .await
        .unwrap();

    let db = connect(&config, false).await;
    assert_eq!(
        db.dialect(),
        crate::adapters::dialect::Dialect::Mysql {
            backslash_escapes: false
        }
    );
    let insert = sql_builder::change_sql(
        db.dialect(),
        "test",
        "paths",
        &RowChange::Insert {
            values: vec![
                ColumnValue {
                    column: "id".into(),
                    value: Some("1".into()),
                },
                ColumnValue {
                    column: "path".into(),
                    value: Some(r"C:\temp".into()),
                },
            ],
        },
    )
    .unwrap();
    db.apply(&[insert]).await.unwrap();

    let stored = run(&db, "SELECT path FROM paths").await.unwrap();
    assert_eq!(stored.first.batch.rows[0][0], Cell::Text(r"C:\temp".into()));
}

#[tokio::test]
async fn connections_go_back_to_the_pool() {
    let (_container, config) = start().await;
    let db = connect(&config, false).await;
    run(
        &db,
        "CREATE TABLE t (id INT PRIMARY KEY); INSERT INTO t VALUES (1), (2)",
    )
    .await
    .unwrap();
    let request = BrowseRequest {
        schema: "test".into(),
        table: "t".into(),
        filters: vec![],
        sort: None,
        page: 0,
        page_size: 1,
    };

    // four times the pool size: a connection left "waiting" after its last result
    // would exhaust the pool and time out here
    for _ in 0..20 {
        run(&db, "UPDATE t SET id = id WHERE id = 1").await.unwrap();
        run(&db, "SELECT * FROM t").await.unwrap();
        db.browse(&request).await.unwrap();
    }
}
