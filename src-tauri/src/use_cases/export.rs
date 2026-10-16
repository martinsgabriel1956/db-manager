//! Exports stream straight to a file: rows (SQL → CSV), documents (MongoDB →
//! NDJSON / JSON array) or keys (Redis → NDJSON) are written batch by batch, never held in memory. The file
//! is written next to the target as `<name>.part` and renamed at the end, so a
//! failed or cancelled export leaves an existing file untouched.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use crate::adapters::csv;
use crate::domain::{AppError, BrowseRequest, DocumentFormat, ExportOutcome, FindRequest};
use crate::registry::{OpenConnection, Registry};
use crate::storage::history::HistoryStore;
use crate::use_cases::guard;
use crate::use_cases::sql::{EDITOR_BATCH_SIZE, elapsed_ms, record, validate_browse};

/// Runs a read-only script and writes the last statement's rows as CSV. Tagged
/// with `run_id`, so `cancel_run` stops it.
pub async fn export_query(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    sql: &str,
    path: &str,
) -> Result<ExportOutcome, AppError> {
    let connection = registry.connection(connection_id)?;
    let dialect = connection.sql()?.dialect();
    let statements = dialect.split(sql);
    if statements.is_empty() {
        return Err(AppError::validation("nenhum comando para exportar"));
    }
    // exporting must never change data: writes go through the editor and its confirmations
    if statements
        .iter()
        .any(|statement| guard::classify(statement, dialect).writes)
    {
        return Err(AppError::validation(
            "o export só executa consultas de leitura; rode as escritas no editor",
        ));
    }
    export_csv(
        registry,
        history,
        connection_id,
        &connection,
        run_id,
        &statements,
        sql,
        path,
    )
    .await
}

/// The whole table with the grid's filters and sort (paging ignored), as CSV.
pub async fn export_table(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    request: BrowseRequest,
    path: &str,
) -> Result<ExportOutcome, AppError> {
    validate_browse(&request)?;
    let connection = registry.connection(connection_id)?;
    let sql_connection = connection.sql()?;
    let primary_key = sql_connection
        .primary_key(&request.schema, &request.table)
        .await?;
    let sql =
        crate::adapters::sql_builder::select_sql(sql_connection.dialect(), &request, &primary_key)?;
    export_csv(
        registry,
        history,
        connection_id,
        &connection,
        run_id,
        std::slice::from_ref(&sql),
        &sql,
        path,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn export_csv(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    connection: &Arc<OpenConnection>,
    run_id: &str,
    statements: &[String],
    sql: &str,
    path: &str,
) -> Result<ExportOutcome, AppError> {
    let target = target_path(path)?;
    let started = Instant::now();
    let result = write_csv(registry, connection, run_id, statements, &target).await;
    registry.finish_run(run_id);
    let result = finish(result, &target);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        connection,
        &format!("-- export CSV → {}\n{sql}", target.display()),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(ExportOutcome {
        rows: result?,
        duration_ms,
    })
}

async fn write_csv(
    registry: &Registry,
    connection: &Arc<OpenConnection>,
    run_id: &str,
    statements: &[String],
    target: &Path,
) -> Result<u32, AppError> {
    let run = connection
        .sql()?
        .run_script(statements, EDITOR_BATCH_SIZE, |pid| {
            registry.start_run(run_id, connection.clone(), pid)
        })
        .await?;
    let mut batch = run.first.batch;
    if batch.columns.is_empty() {
        return Err(AppError::validation("o último comando não retorna linhas"));
    }

    let mut out = BufWriter::new(File::create(part_path(target))?);
    let names: Vec<String> = batch.columns.iter().map(|c| c.name.clone()).collect();
    csv::write_header(&mut out, &names)?;
    let mut rows: u32 = 0;
    loop {
        for row in &batch.rows {
            csv::write_row(&mut out, row)?;
            rows = rows.saturating_add(1);
        }
        match (&run.cursor, batch.has_more) {
            (Some(cursor), true) => batch = cursor.next().await?.batch,
            _ => break,
        }
    }
    out.flush()?;
    Ok(rows)
}

/// Every document matching the filter (sort and projection applied), streamed.
pub async fn export_collection(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    request: FindRequest,
    format: DocumentFormat,
    path: &str,
) -> Result<ExportOutcome, AppError> {
    let connection = registry.connection(connection_id)?;
    let mongo = connection.mongo()?;
    let target = target_path(path)?;

    registry.start_run(run_id, connection.clone(), 0);
    let started = Instant::now();
    let result = async {
        let mut out = BufWriter::new(File::create(part_path(&target))?);
        if format == DocumentFormat::JsonArray {
            out.write_all(b"[")?;
        }
        let mut first = true;
        let count = mongo
            .export_documents(&request, run_id, |document| {
                match (format, first) {
                    (DocumentFormat::Ndjson, _) => writeln!(out, "{document}")?,
                    (DocumentFormat::JsonArray, true) => write!(out, "\n{document}")?,
                    (DocumentFormat::JsonArray, false) => write!(out, ",\n{document}")?,
                }
                first = false;
                Ok(())
            })
            .await?;
        if format == DocumentFormat::JsonArray {
            out.write_all(b"\n]\n")?;
        }
        out.flush()?;
        Ok(count)
    }
    .await;
    registry.finish_run(run_id);
    let result = finish(result, &target);
    let duration_ms = elapsed_ms(started);

    let label = match format {
        DocumentFormat::Ndjson => "NDJSON",
        DocumentFormat::JsonArray => "JSON",
    };
    let filter = match request.filter.trim() {
        "" => "{}",
        filter => filter,
    };
    record(
        history,
        connection_id,
        &connection,
        &format!(
            "// export {label} → {}\n{}.{}.find({filter})",
            target.display(),
            request.database,
            request.collection
        ),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(ExportOutcome {
        rows: result?,
        duration_ms,
    })
}

/// Every key of `db` matching `pattern` (SCAN MATCH, never KEYS), one NDJSON line
/// per key. Only reads: allowed everywhere without asking. `cancel_run` stops it
/// between keys.
// ponytail: SCAN may return a key twice while the server rehashes; the file then has it twice
pub async fn export_keys(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    db: u8,
    pattern: &str,
    path: &str,
) -> Result<ExportOutcome, AppError> {
    let connection = registry.connection(connection_id)?;
    let redis = connection.redis()?;
    let target = target_path(path)?;
    let pattern = match pattern.trim() {
        "" => "*",
        pattern => pattern,
    };

    registry.start_run(run_id, connection.clone(), 0);
    let started = Instant::now();
    let result = async {
        let mut out = BufWriter::new(File::create(part_path(&target))?);
        let mut cursor = "0".to_string();
        let mut count: u32 = 0;
        loop {
            let (next, names) = redis.scan_names(db, pattern, &cursor).await?;
            for name in names {
                // cancel_run on Redis just ends the run
                if registry.running(run_id).is_none() {
                    return Err(AppError::Cancelled("export cancelado".to_string()));
                }
                if let Some(line) = redis.export_key(db, &name).await? {
                    writeln!(out, "{line}")?;
                    count = count.saturating_add(1);
                }
            }
            cursor = next;
            if cursor == "0" {
                break;
            }
        }
        out.flush()?;
        Ok(count)
    }
    .await;
    registry.finish_run(run_id);
    let result = finish(result, &target);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        &connection,
        &format!(
            "# export NDJSON → {}\nSELECT {db}\nSCAN 0 MATCH {}",
            target.display(),
            crate::adapters::redis::reply::command_line(&[pattern])
        ),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(ExportOutcome {
        rows: result?,
        duration_ms,
    })
}

fn target_path(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(AppError::validation("escolha um arquivo de destino"));
    }
    Ok(path)
}

fn part_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    target.with_file_name(name)
}

/// Moves the finished `.part` into place, or removes it after a failure.
fn finish(result: Result<u32, AppError>, target: &Path) -> Result<u32, AppError> {
    let part = part_path(target);
    match result {
        Ok(rows) => {
            std::fs::rename(&part, target)?;
            Ok(rows)
        }
        Err(err) => {
            let _ = std::fs::remove_file(&part);
            Err(err)
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use std::time::Duration;

    use super::*;
    use crate::domain::{Filter, FilterOp, RunResponse};
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

    fn path_in(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().into_owned()
    }

    fn read(path: &str) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[tokio::test]
    async fn postgres_exports_csv_and_draws_the_schema() {
        let (_container, config) = crate::adapters::postgres::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let id = config.id.clone();
        sql::connect(&registry, &Password(Some("postgres")), config)
            .await
            .unwrap();
        let setup = "CREATE TABLE teams (id int PRIMARY KEY, name text);
            CREATE TABLE people (id int PRIMARY KEY, team_id int REFERENCES teams (id), name text, note text);
            CREATE VIEW people_view AS SELECT * FROM people;
            INSERT INTO teams VALUES (1, 'core');
            INSERT INTO people VALUES
              (1, 1, 'Ana', NULL), (2, 1, '', 'a,b'), (3, NULL, 'Bia', 'say \"hi\"' || chr(10) || 'bye')";
        let RunResponse::Executed { .. } =
            sql::run_script(&registry, &history, &id, "setup", setup, false)
                .await
                .unwrap()
        else {
            panic!("setup ran");
        };

        // the diagram: tables only, with their outgoing foreign keys
        let diagram = sql::schema_diagram(&registry, &id, "public").await.unwrap();
        let names: Vec<&str> = diagram.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["people", "teams"]);
        assert_eq!(diagram[0].foreign_keys[0].referenced_table, "teams");
        assert_eq!(diagram[0].foreign_keys[0].columns, ["team_id"]);
        assert!(diagram[1].foreign_keys.is_empty());
        assert!(matches!(
            sql::schema_diagram(&registry, &id, "nope").await,
            Err(AppError::NotFound(_))
        ));

        let dir = tempfile::tempdir().unwrap();
        let path = path_in(&dir, "people.csv");
        let outcome = export_query(
            &registry,
            &history,
            &id,
            "e1",
            "SET search_path TO public; SELECT id, name, note FROM people ORDER BY id",
            &path,
        )
        .await
        .unwrap();
        assert_eq!(outcome.rows, 3);
        // NULL is empty, '' is "" and specials are quoted
        assert_eq!(
            read(&path),
            "id,name,note\n1,Ana,\n2,\"\",\"a,b\"\n3,Bia,\"say \"\"hi\"\"\nbye\"\n"
        );

        // the table with the grid's filter, every page
        let table_path = path_in(&dir, "table.csv");
        let request = BrowseRequest {
            schema: "public".into(),
            table: "people".into(),
            filters: vec![Filter {
                column: "team_id".into(),
                op: FilterOp::IsNotNull,
                value: None,
            }],
            sort: None,
            page: 0,
            page_size: 1,
        };
        let outcome = export_table(&registry, &history, &id, "e2", request, &table_path)
            .await
            .unwrap();
        assert_eq!(outcome.rows, 2);
        assert!(read(&table_path).starts_with("id,team_id,name,note\n1,1,Ana,\n"));

        // never writes, and a failure leaves an existing file as it was
        std::fs::write(&path, "old").unwrap();
        let refused =
            export_query(&registry, &history, &id, "e3", "DELETE FROM people", &path).await;
        assert!(matches!(refused, Err(AppError::Validation(_))));
        let failed = export_query(
            &registry,
            &history,
            &id,
            "e4",
            "SELECT * FROM missing",
            &path,
        )
        .await;
        assert!(matches!(failed, Err(AppError::Database(_))));
        assert_eq!(read(&path), "old");
        assert!(!dir.path().join("people.csv.part").exists());

        // cancel stops the query on the server and writes nothing
        let slow_path = path_in(&dir, "slow.csv");
        let (result, cancelled) = tokio::join!(
            export_query(
                &registry,
                &history,
                &id,
                "slow",
                "SELECT pg_sleep(10)",
                &slow_path
            ),
            async {
                tokio::time::sleep(Duration::from_millis(500)).await;
                sql::cancel_run(&registry, "slow").await
            }
        );
        cancelled.unwrap();
        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert!(!std::path::Path::new(&slow_path).exists());

        assert!(matches!(
            export_query(&registry, &history, &id, "e5", "SELECT 1", "relative.csv").await,
            Err(AppError::Validation(_))
        ));

        let entries = history
            .search("export CSV", Some(&id), false, 10)
            .await
            .unwrap();
        assert!(entries.iter().any(|e| e.sql.contains("people.csv")));
    }

    #[tokio::test]
    async fn mongo_exports_ndjson_and_json_arrays() {
        let (_container, config) = crate::adapters::mongo::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let id = config.id.clone();
        sql::connect(&registry, &Password(None), config)
            .await
            .unwrap();
        let mongo = registry.connection(&id).unwrap();
        for document in [
            r#"{"_id": 1, "kind": "a", "big": {"$numberLong": "9007199254740993"}}"#,
            r#"{"_id": 2, "kind": "b"}"#,
            r#"{"_id": 3, "kind": "a"}"#,
        ] {
            mongo
                .mongo()
                .unwrap()
                .insert(
                    "shop",
                    "items",
                    crate::adapters::mongo::ejson::parse_document(document, "doc").unwrap(),
                )
                .await
                .unwrap();
        }
        let request = |filter: &str| FindRequest {
            database: "shop".into(),
            collection: "items".into(),
            filter: filter.into(),
            sort: r#"{"_id": -1}"#.into(),
            projection: String::new(),
            page: 0,
            page_size: 1,
        };
        let dir = tempfile::tempdir().unwrap();

        let ndjson = path_in(&dir, "items.ndjson");
        let outcome = export_collection(
            &registry,
            &history,
            &id,
            "m1",
            request(r#"{"kind": "a"}"#),
            DocumentFormat::Ndjson,
            &ndjson,
        )
        .await
        .unwrap();
        assert_eq!(outcome.rows, 2);
        assert_eq!(
            read(&ndjson),
            "{\"_id\":3,\"kind\":\"a\"}\n{\"_id\":1,\"kind\":\"a\",\"big\":{\"$numberLong\":\"9007199254740993\"}}\n"
        );

        let json = path_in(&dir, "items.json");
        export_collection(
            &registry,
            &history,
            &id,
            "m2",
            request(""),
            DocumentFormat::JsonArray,
            &json,
        )
        .await
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&read(&json)).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 3);

        let empty = path_in(&dir, "empty.json");
        export_collection(
            &registry,
            &history,
            &id,
            "m3",
            request(r#"{"kind": "zzz"}"#),
            DocumentFormat::JsonArray,
            &empty,
        )
        .await
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&read(&empty)).unwrap();
        assert!(parsed.as_array().unwrap().is_empty());

        let invalid = export_collection(
            &registry,
            &history,
            &id,
            "m4",
            request("{bad"),
            DocumentFormat::Ndjson,
            &ndjson,
        )
        .await;
        assert!(matches!(invalid, Err(AppError::Validation(_))));
        assert!(
            read(&ndjson).starts_with("{\"_id\":3"),
            "kept the previous export"
        );

        let entries = history
            .search("export NDJSON", Some(&id), false, 10)
            .await
            .unwrap();
        assert!(entries.iter().any(|e| {
            e.sql.ends_with(r#"shop.items.find({"kind": "a"})"#) && e.error.is_none()
        }));
        // the refused filter is in the history too, with its error
        assert!(entries.iter().any(|e| e.error.is_some()));
    }

    #[tokio::test]
    async fn redis_exports_every_key_as_ndjson_without_loss() {
        let (_container, config) = crate::adapters::redis::integration_tests::start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        let id = config.id.clone();
        sql::connect(&registry, &Password(None), config)
            .await
            .unwrap();
        let connection = registry.connection(&id).unwrap();
        let redis = connection.redis().unwrap();
        for line in [
            "SET s:text São",
            r#"SET s:bin "\xff\x00a""#,
            "EXPIRE s:text 600",
            r#"HSET h:1 name Ana "\xfe" x"#,
            "RPUSH l:1 a b a",
            "SADD set:1 x",
            "ZADD z:1 1.5 m +inf top",
            "XADD x:1 1-1 f v",
            "SET other 1",
        ] {
            crate::adapters::redis::integration_tests::run(redis, 0, line).await;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = path_in(&dir, "keys.ndjson");

        let outcome = export_keys(&registry, &history, &id, "r1", 0, "*:*", &path)
            .await
            .unwrap();
        assert_eq!(outcome.rows, 7);
        let mut lines: Vec<serde_json::Value> = read(&path)
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        lines.sort_by_key(|line| line["key"].to_string());
        let by_key = |key: &str| {
            lines
                .iter()
                .find(|line| line["key"] == key)
                .unwrap_or_else(|| panic!("{key} exported"))
        };
        let text = by_key("s:text");
        assert_eq!(text["type"], "string");
        assert_eq!(text["value"], "São");
        assert!(text["pttl"].as_i64().unwrap() > 590_000);
        assert_eq!(
            by_key("s:bin")["value"],
            serde_json::json!({"$base64": "/wBh"})
        );
        assert!(by_key("s:bin")["pttl"].is_null());
        assert_eq!(
            by_key("h:1")["value"],
            serde_json::json!([["name", "Ana"], [{"$base64": "/g=="}, "x"]])
        );
        assert_eq!(by_key("l:1")["value"], serde_json::json!(["a", "b", "a"]));
        assert_eq!(by_key("set:1")["value"], serde_json::json!(["x"]));
        assert_eq!(
            by_key("z:1")["value"],
            serde_json::json!([["m", "1.5"], ["top", "inf"]])
        );
        assert_eq!(
            by_key("x:1")["value"],
            serde_json::json!([{"id": "1-1", "fields": [["f", "v"]]}])
        );
        assert!(!read(&path).contains("other"));

        // a big collection comes whole, past the viewer's limit
        let values: Vec<String> = (0..2500).map(|n| n.to_string()).collect();
        redis
            .atomic(
                0,
                &values
                    .iter()
                    .map(|n| vec!["RPUSH".to_string(), "big".to_string(), n.clone()])
                    .collect::<Vec<_>>(),
            )
            .await
            .unwrap();
        let big = path_in(&dir, "big.ndjson");
        export_keys(&registry, &history, &id, "r2", 0, "big", &big)
            .await
            .unwrap();
        let line: serde_json::Value = serde_json::from_str(read(&big).trim()).unwrap();
        assert_eq!(line["value"].as_array().unwrap().len(), 2500);
        assert_eq!(line["value"][2499], "2499");

        // cancelled between keys: nothing written, an existing file kept
        std::fs::write(&path, "old").unwrap();
        let many: Vec<Vec<String>> = (0..3000)
            .map(|n| vec!["SET".to_string(), format!("many:{n}"), "v".to_string()])
            .collect();
        redis.atomic(0, &many).await.unwrap();
        let (result, cancelled) = tokio::join!(
            export_keys(&registry, &history, &id, "r3", 0, "*", &path),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                sql::cancel_run(&registry, "r3").await
            }
        );
        cancelled.unwrap();
        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert_eq!(read(&path), "old");

        let entries = history
            .search("export NDJSON", Some(&id), false, 10)
            .await
            .unwrap();
        assert!(
            entries
                .iter()
                .any(|e| { e.sql.ends_with("SELECT 0\nSCAN 0 MATCH *:*") && e.error.is_none() })
        );
        assert!(entries.iter().any(|e| e.error.is_some()));
    }
}
