//! Exports stream straight to a file: rows (SQL → CSV) or documents (MongoDB →
//! NDJSON / JSON array) are written batch by batch, never held in memory. The file
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

        let entries = history.search("export CSV", Some(&id), 10).await.unwrap();
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
            .search("export NDJSON", Some(&id), 10)
            .await
            .unwrap();
        assert!(entries.iter().any(|e| {
            e.sql.ends_with(r#"shop.items.find({"kind": "a"})"#) && e.error.is_none()
        }));
        // the refused filter is in the history too, with its error
        assert!(entries.iter().any(|e| e.error.is_some()));
    }
}
