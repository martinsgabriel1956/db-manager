//! Runs against real SQLite files in a temp dir.

use super::SqliteAdapter;
use crate::adapters::sql_builder;
use crate::adapters::stream::ScriptRun;
use crate::domain::{
    AppError, BrowseRequest, Cell, ColumnValue, ConnectionConfig, Engine, Environment, Filter,
    FilterOp, KeyValue, RelationKind, RowChange, Target, TlsConfig, TlsMode,
};

pub(crate) fn config(path: &std::path::Path) -> ConnectionConfig {
    ConnectionConfig {
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
    }
}

async fn run(db: &SqliteAdapter, sql: &str) -> Result<ScriptRun, AppError> {
    db.run_script(&SqliteAdapter::DIALECT.split(sql), 1000, |_| {})
        .await
}

/// SQLite won't create files on connect (by design), so tests create them first.
async fn database(dir: &tempfile::TempDir, name: &str, setup: &str) -> ConnectionConfig {
    let path = dir.path().join(name);
    std::fs::File::create(&path).unwrap();
    let config = config(&path);
    let db = SqliteAdapter::connect(&config, false).await.unwrap();
    run(&db, setup).await.unwrap();
    db.close().await;
    config
}

#[tokio::test]
async fn missing_file_is_an_error_not_a_new_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("typo.db");

    let result = SqliteAdapter::connect(&config(&path), false).await;

    assert!(matches!(result, Err(AppError::Database(_))));
    assert!(!path.exists());
}

#[tokio::test]
async fn values_introspection_and_triggers() {
    let dir = tempfile::tempdir().unwrap();
    let config = database(
        &dir,
        "app.db",
        r"CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
          CREATE TABLE people (
            id INTEGER PRIMARY KEY,
            team_id INTEGER REFERENCES teams(id),
            name TEXT NOT NULL,
            score REAL,
            avatar BLOB,
            joined TEXT DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX people_name ON people (name);
          CREATE VIEW scored AS SELECT * FROM people WHERE score IS NOT NULL;
          CREATE TABLE counter (n INTEGER);
          INSERT INTO counter VALUES (0);
          CREATE TRIGGER count_people AFTER INSERT ON people BEGIN
            UPDATE counter SET n = n + 1;
          END;
          INSERT INTO teams VALUES (1, 'core');
          INSERT INTO people (id, team_id, name, score, avatar)
            VALUES (9007199254740993, 1, 'Ana', 1.5, X'00FF'), (2, 1, 'Bia', NULL, NULL)",
    )
    .await;
    let db = SqliteAdapter::connect(&config, false).await.unwrap();

    let script = run(
        &db,
        "SELECT id, name, score, avatar, 'x' || 1 FROM people ORDER BY name",
    )
    .await
    .unwrap();
    assert_eq!(
        script.first.batch.rows[0],
        vec![
            Cell::Int("9007199254740993".into()),
            Cell::Text("Ana".into()),
            Cell::Float(1.5),
            Cell::Bytes {
                len: 2,
                preview_hex: "00ff".into(),
            },
            Cell::Text("x1".into()),
        ]
    );
    assert_eq!(script.first.batch.rows[1][2], Cell::Null);
    let editable: Vec<_> = script
        .first
        .batch
        .columns
        .iter()
        .map(|c| c.editable)
        .collect();
    assert_eq!(editable, vec![true, true, true, false, true]);

    // the trigger body (with its own ;) ran as one statement
    let counter = run(&db, "SELECT n FROM counter").await.unwrap();
    assert_eq!(counter.first.batch.rows[0][0], Cell::Int("2".into()));

    let schemas = db.list_schemas().await.unwrap();
    assert_eq!(schemas[0].name, "main");
    let relations: Vec<_> = schemas[0]
        .relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        relations,
        vec![
            ("counter", RelationKind::Table),
            ("people", RelationKind::Table),
            ("scored", RelationKind::View),
            ("teams", RelationKind::Table),
        ]
    );

    let structure = db.table_structure("main", "people").await.unwrap();
    assert!(structure.columns[0].is_primary_key);
    assert!(!structure.columns[2].nullable);
    assert_eq!(
        structure.columns[5].default.as_deref(),
        Some("CURRENT_TIMESTAMP")
    );
    assert!(
        structure
            .indexes
            .iter()
            .any(|i| i.definition == "CREATE INDEX people_name ON people (name)")
    );
    assert_eq!(
        structure.foreign_keys[0].definition,
        "FOREIGN KEY (team_id) REFERENCES teams (id)"
    );
    let key = &structure.foreign_keys[0];
    assert_eq!(key.columns, ["team_id"]);
    assert_eq!(
        (
            key.referenced_schema.as_str(),
            key.referenced_table.as_str()
        ),
        ("main", "teams")
    );
    assert_eq!(key.referenced_columns, ["id"]);
    let teams = db.table_structure("main", "teams").await.unwrap();
    assert!(
        teams
            .indexes
            .iter()
            .any(|i| i.definition == "UNIQUE (automático)")
    );
    assert_eq!(db.primary_key("main", "people").await.unwrap(), vec!["id"]);
    assert!(db.primary_key("main", "counter").await.unwrap().is_empty());
    assert!(matches!(
        db.table_structure("main", "missing").await,
        Err(AppError::NotFound(_))
    ));

    let completion = db.completion_tables().await.unwrap();
    let teams = completion.iter().find(|t| t.table == "teams").unwrap();
    assert_eq!(teams.columns, vec!["id", "name"]);
}

#[tokio::test]
async fn browsing_streaming_and_edits() {
    let dir = tempfile::tempdir().unwrap();
    let config = database(
        &dir,
        "items.db",
        r"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, note TEXT);
          WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 25)
          INSERT INTO items SELECT n, 'item' || n, CASE WHEN n % 2 = 0 THEN 'it''s \ even' END FROM seq",
    )
    .await;
    let db = SqliteAdapter::connect(&config, false).await.unwrap();

    let page = |page, filters| BrowseRequest {
        schema: "main".into(),
        table: "items".into(),
        filters,
        sort: None,
        page,
        page_size: 10,
    };
    let filter = |column: &str, op, value: Option<&str>| Filter {
        column: column.into(),
        op,
        value: value.map(str::to_string),
    };
    let first = db.browse(&page(0, vec![])).await.unwrap();
    assert_eq!((first.rows.len(), first.has_more), (10, true));
    let last = db.browse(&page(2, vec![])).await.unwrap();
    assert_eq!((last.rows.len(), last.has_more), (5, false));
    let escaped = db
        .browse(&page(
            0,
            vec![filter("note", FilterOp::Eq, Some(r"it's \ even"))],
        ))
        .await
        .unwrap();
    assert_eq!(escaped.rows.len(), 10);
    let empty = db
        .browse(&page(
            0,
            vec![filter(
                "name",
                FilterOp::Eq,
                Some("x'; DROP TABLE items; --"),
            )],
        ))
        .await
        .unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.columns.len(), 3);

    let script = run(
        &db,
        "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2500) SELECT n FROM seq",
    )
    .await
    .unwrap();
    let cursor = script.cursor.unwrap();
    cursor.next().await.unwrap();
    let tail = cursor.next().await.unwrap();
    assert_eq!((tail.batch.rows.len(), tail.batch.has_more), (500, false));

    let key = |id: &str| {
        vec![KeyValue {
            column: "id".into(),
            value: Cell::Int(id.into()),
        }]
    };
    let sql = |change: RowChange| {
        sql_builder::change_sql(SqliteAdapter::DIALECT, "main", "items", &change).unwrap()
    };
    db.apply(&[
        sql(RowChange::Update {
            key: key("1"),
            values: vec![ColumnValue {
                column: "name".into(),
                value: Some(r"O'Neil \o/".into()),
            }],
        }),
        sql(RowChange::Delete { key: key("2") }),
    ])
    .await
    .unwrap();
    let check = run(&db, "SELECT name FROM items WHERE id IN (1, 2)")
        .await
        .unwrap();
    assert_eq!(
        check.first.batch.rows,
        vec![vec![Cell::Text(r"O'Neil \o/".into())]]
    );
    let conflict = db
        .apply(&[sql(RowChange::Delete { key: key("2") })])
        .await
        .unwrap_err();
    assert!(matches!(conflict, AppError::Conflict(_)));
}

#[tokio::test]
async fn read_only_opens_the_file_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = database(&dir, "ro.db", "CREATE TABLE t (id INTEGER PRIMARY KEY)").await;
    config.read_only = true;
    let db = SqliteAdapter::connect(&config, true).await.unwrap();

    let err = run(&db, "INSERT INTO t VALUES (1)").await.err().unwrap();

    assert!(err.to_string().contains("readonly"), "{err}");
}
