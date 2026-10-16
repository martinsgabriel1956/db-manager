//! Imports read a file batch by batch, never whole: a CSV goes into a SQL table in
//! one transaction (an error on any line rolls everything back and names the line).
//! Nothing runs before the user saw the sample INSERT and the row count.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use crate::adapters::csv::{self, Record};
use crate::adapters::dialect::Dialect;
use crate::adapters::{SqlTransaction, error_position, sql_builder};
use crate::domain::{AppError, Confirmation, CsvImport, CsvPreview, ImportResponse};
use crate::registry::{OpenConnection, Registry};
use crate::storage::history::HistoryStore;
use crate::use_cases::sql::{elapsed_ms, record};

const PREVIEW_ROWS: usize = 10;
/// rows shown in the sample INSERT of the confirmation
const SAMPLE_ROWS: usize = 3;
const BATCH_ROWS: usize = 500;
const SAVEPOINT: &str = "ordo_import";

type CsvReader = csv::Reader<BufReader<File>>;

/// The header and the first rows, to map the columns.
pub fn preview_csv(path: &str) -> Result<CsvPreview, AppError> {
    let (mut reader, columns) = open_csv(path)?;
    let mut rows = Vec::new();
    while rows.len() < PREVIEW_ROWS {
        match reader.next_record()? {
            Some(record) => rows.push(record.fields),
            None => break,
        }
    }
    Ok(CsvPreview {
        columns,
        rows,
        delimiter: reader.delimiter().to_string(),
    })
}

/// Unconfirmed, reads the whole file (every line checked) and answers with the
/// sample INSERT and the row count; confirmed, imports it under `run_id`, which
/// `cancel_run` stops.
pub async fn import_csv(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    request: CsvImport,
    confirmed: bool,
) -> Result<ImportResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let (mut reader, header) = open_csv(&request.path)?;
    let target = CsvTarget::new(&connection, &request, &header).await?;

    if !confirmed {
        let mut sample = Vec::new();
        let mut total: u64 = 0;
        while let Some(record) = reader.next_record()? {
            if sample.len() < SAMPLE_ROWS {
                sample.push(target.pick(record));
            }
            total += 1;
        }
        if total == 0 {
            return Err(AppError::validation(
                "o arquivo só tem o cabeçalho: nenhuma linha para importar",
            ));
        }
        let rows = if total == 1 {
            "1 linha".to_string()
        } else {
            format!("{total} linhas")
        };
        return Ok(ImportResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: format!(
                    "Importar {rows} de {} em {}.{}, numa transação, em lotes de até \
                     {BATCH_ROWS} linhas: um erro em qualquer linha desfaz tudo. \
                     Abaixo, o INSERT das primeiras linhas.",
                    file_name(&request.path),
                    request.schema,
                    request.table
                ),
                statements: vec![target.insert(&sample)?],
                destructive: false,
            },
        });
    }

    let started = Instant::now();
    let result = insert_all(registry, &connection, run_id, &target, &mut reader).await;
    registry.finish_run(run_id);
    let result = result.map_err(nothing_saved);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        &connection,
        &format!(
            "-- import CSV ← {}\n{} …",
            request.path,
            target.insert(&[])?.trim_end()
        ),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(ImportResponse::Imported {
        rows: result?,
        duration_ms,
    })
}

/// Where the file's columns go: the table columns, in mapping order.
struct CsvTarget {
    dialect: Dialect,
    schema: String,
    table: String,
    columns: Vec<String>,
    sources: Vec<usize>,
    /// how errors name a column: `file → table` when the names differ
    labels: Vec<String>,
}

impl CsvTarget {
    async fn new(
        connection: &OpenConnection,
        request: &CsvImport,
        header: &[String],
    ) -> Result<Self, AppError> {
        if request.mapping.is_empty() {
            return Err(AppError::validation(
                "escolha ao menos uma coluna do arquivo para importar",
            ));
        }
        let sql = connection.sql()?;
        let structure = sql.table_structure(&request.schema, &request.table).await?;
        let mut seen = BTreeSet::new();
        let mut labels = Vec::new();
        for mapping in &request.mapping {
            let Some(source) = header.get(mapping.source as usize) else {
                return Err(AppError::validation(format!(
                    "o arquivo não tem a coluna {}",
                    mapping.source + 1
                )));
            };
            if !structure.columns.iter().any(|c| c.name == mapping.column) {
                return Err(AppError::validation(format!(
                    "a tabela {} não tem a coluna {}",
                    request.table, mapping.column
                )));
            }
            if !seen.insert(&mapping.column) {
                return Err(AppError::validation(format!(
                    "a coluna {} recebe mais de uma coluna do arquivo",
                    mapping.column
                )));
            }
            labels.push(if *source == mapping.column {
                mapping.column.clone()
            } else {
                format!("{source} → {}", mapping.column)
            });
        }
        Ok(CsvTarget {
            dialect: sql.dialect(),
            schema: request.schema.clone(),
            table: request.table.clone(),
            columns: request.mapping.iter().map(|m| m.column.clone()).collect(),
            sources: request.mapping.iter().map(|m| m.source as usize).collect(),
            labels,
        })
    }

    fn pick(&self, record: Record) -> Vec<Option<String>> {
        let mut fields = record.fields;
        self.sources
            .iter()
            .map(|&source| fields[source].take())
            .collect()
    }

    fn insert(&self, rows: &[Vec<Option<String>>]) -> Result<String, AppError> {
        sql_builder::insert_rows_sql(self.dialect, &self.schema, &self.table, &self.columns, rows)
    }
}

async fn insert_all(
    registry: &Registry,
    connection: &Arc<OpenConnection>,
    run_id: &str,
    target: &CsvTarget,
    reader: &mut CsvReader,
) -> Result<u32, AppError> {
    let (mut tx, session) = connection.sql()?.begin().await?;
    registry.start_run(run_id, connection.clone(), session);
    let mut imported: u32 = 0;
    loop {
        let mut lines = Vec::with_capacity(BATCH_ROWS);
        let mut rows = Vec::with_capacity(BATCH_ROWS);
        while rows.len() < BATCH_ROWS {
            let Some(record) = reader.next_record()? else {
                break;
            };
            lines.push(record.line);
            rows.push(target.pick(record));
        }
        if registry.cancel_requested(run_id) {
            return Err(AppError::cancelled());
        }
        if rows.is_empty() {
            break;
        }
        // a savepoint per batch, so a failed one can be replayed row by row
        tx.execute(&format!("SAVEPOINT {SAVEPOINT}")).await?;
        if let Err(err) = tx.execute(&target.insert(&rows)?).await {
            return Err(locate(&mut tx, target, &lines, &rows, err).await);
        }
        tx.execute(&format!("RELEASE SAVEPOINT {SAVEPOINT}"))
            .await?;
        imported = imported.saturating_add(u32::try_from(rows.len()).unwrap_or(u32::MAX));
    }
    tx.commit().await?;
    Ok(imported)
}

/// A batch failed: replays it one row at a time from its savepoint to name the line
/// (and, on PostgreSQL, the column) the database refused. The caller rolls back.
async fn locate(
    tx: &mut SqlTransaction,
    target: &CsvTarget,
    lines: &[u64],
    rows: &[Vec<Option<String>>],
    batch_error: sqlx::Error,
) -> AppError {
    let batch_error = AppError::from(batch_error);
    if matches!(batch_error, AppError::Cancelled(_))
        || tx
            .execute(&format!("ROLLBACK TO SAVEPOINT {SAVEPOINT}"))
            .await
            .is_err()
    {
        return batch_error;
    }
    for (line, row) in lines.iter().zip(rows) {
        let Ok(statement) = target.insert(std::slice::from_ref(row)) else {
            continue;
        };
        if let Err(err) = tx.execute(&statement).await {
            let column = error_position(&err)
                .and_then(|position| {
                    sql_builder::value_at(target.dialect, &statement, row, position)
                })
                .map(|index| format!(", coluna {}", target.labels[index]))
                .unwrap_or_default();
            return AppError::Database(format!("linha {line}{column}: {}", AppError::from(err)));
        }
    }
    // every row passes alone: the batch failed as a whole
    AppError::Database(format!(
        "lote que começa na linha {}: {batch_error}",
        lines.first().copied().unwrap_or_default()
    ))
}

/// The transaction rolled back: the message says nothing was written.
fn nothing_saved(err: AppError) -> AppError {
    match err {
        AppError::Cancelled(_) => {
            AppError::Cancelled("importação cancelada: nada foi gravado".to_string())
        }
        AppError::Validation(message) => {
            AppError::Validation(format!("{message}. Nada foi gravado"))
        }
        AppError::Database(message) => AppError::Database(format!("{message}. Nada foi gravado")),
        AppError::Storage(message) => AppError::Storage(format!("{message}. Nada foi gravado")),
        other => other,
    }
}

fn open_csv(path: &str) -> Result<(CsvReader, Vec<String>), AppError> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(AppError::validation("escolha um arquivo para importar"));
    }
    let file = File::open(&path).map_err(|err| {
        AppError::validation(format!("não foi possível abrir {}: {err}", path.display()))
    })?;
    csv::Reader::new(BufReader::new(file))
}

fn file_name(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod integration_tests {
    use std::fmt::Write as _;
    use std::time::Duration;

    use super::*;
    use crate::domain::{Cell, ColumnMapping, ConnectionConfig, RunResponse, StatementResult};
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

    struct Db {
        registry: Registry,
        history: HistoryStore,
        id: String,
        schema: &'static str,
        dir: tempfile::TempDir,
    }

    impl Db {
        async fn open(
            config: ConnectionConfig,
            password: Option<&'static str>,
            schema: &'static str,
        ) -> Db {
            let registry = Registry::default();
            let id = config.id.clone();
            sql::connect(&registry, &Password(password), config)
                .await
                .unwrap();
            Db {
                registry,
                history: HistoryStore::in_memory().await,
                id,
                schema,
                dir: tempfile::tempdir().unwrap(),
            }
        }

        async fn run(&self, script: &str) -> Vec<Vec<Option<String>>> {
            let RunResponse::Executed { outcome } =
                sql::run_script(&self.registry, &self.history, &self.id, "q", script, false)
                    .await
                    .unwrap()
            else {
                panic!("{script} ran");
            };
            match outcome.result {
                StatementResult::Rows { batch, .. } => batch
                    .rows
                    .into_iter()
                    .map(|row| row.into_iter().map(text).collect())
                    .collect(),
                StatementResult::Command { .. } => Vec::new(),
            }
        }

        async fn count(&self) -> String {
            self.run("SELECT count(*) FROM people").await[0][0]
                .clone()
                .unwrap()
        }

        fn file(&self, name: &str, text: &str) -> String {
            let path = self.dir.path().join(name);
            std::fs::write(&path, text).unwrap();
            path.to_string_lossy().into_owned()
        }

        fn request(&self, path: &str, columns: &[&str]) -> CsvImport {
            CsvImport {
                schema: self.schema.into(),
                table: "people".into(),
                path: path.into(),
                mapping: columns
                    .iter()
                    .enumerate()
                    .map(|(source, column)| ColumnMapping {
                        source: source as u32,
                        column: column.to_string(),
                    })
                    .collect(),
            }
        }

        async fn import(
            &self,
            run_id: &str,
            request: CsvImport,
            confirmed: bool,
        ) -> Result<ImportResponse, AppError> {
            import_csv(
                &self.registry,
                &self.history,
                &self.id,
                run_id,
                request,
                confirmed,
            )
            .await
        }
    }

    fn text(cell: Cell) -> Option<String> {
        match cell {
            Cell::Null => None,
            Cell::Int(text) | Cell::Text(text) => Some(text),
            other => panic!("unexpected {other:?}"),
        }
    }

    const PEOPLE: [&str; 4] = ["id", "name", "age", "note"];

    /// Header plus three tricky rows (NULL vs '', quotes, a line break, a backslash)
    /// and enough plain ones for three batches.
    fn people_csv() -> String {
        let mut csv = String::from(
            "id,nome,age,note\n1,Ana,30,\n2,O'Brien c:\\temp,,\"\"\n3,Bia,41,\"say \"\"hi\"\"\nbye\"\n",
        );
        for id in 4..=1200 {
            writeln!(csv, "{id},P{id},20,x").unwrap();
        }
        csv
    }

    /// The checks every engine passes; `type_error` is the start of the error for an
    /// age of 'abc' on line 2.
    async fn imports_in_one_transaction(db: &Db, type_error: &str) {
        let path = db.file("people.csv", &people_csv());

        let preview = preview_csv(&path).unwrap();
        assert_eq!(preview.columns, ["id", "nome", "age", "note"]);
        assert_eq!(preview.rows.len(), PREVIEW_ROWS);
        assert_eq!(
            preview.rows[1],
            [
                Some("2".into()),
                Some(r"O'Brien c:\temp".into()),
                None,
                Some(String::new())
            ]
        );
        assert_eq!(preview.delimiter, ",");

        // first the sample INSERT and the count; nothing runs
        let ImportResponse::NeedsConfirmation { confirmation } = db
            .import("i1", db.request(&path, &PEOPLE), false)
            .await
            .unwrap()
        else {
            panic!("asked first");
        };
        assert!(
            confirmation
                .reason
                .contains("Importar 1200 linhas de people.csv"),
            "{}",
            confirmation.reason
        );
        assert!(confirmation.statements[0].starts_with("INSERT INTO "));
        assert!(confirmation.statements[0].contains("'O''Brien"));
        assert_eq!(db.count().await, "0");

        let ImportResponse::Imported { rows, .. } = db
            .import("i2", db.request(&path, &PEOPLE), true)
            .await
            .unwrap()
        else {
            panic!("imported");
        };
        assert_eq!(rows, 1200);
        assert_eq!(db.count().await, "1200");
        assert_eq!(
            db.run("SELECT id, name, age, note FROM people WHERE id <= 3 ORDER BY id")
                .await,
            [
                vec![
                    Some("1".into()),
                    Some("Ana".into()),
                    Some("30".into()),
                    None
                ],
                vec![
                    Some("2".into()),
                    Some(r"O'Brien c:\temp".into()),
                    None,
                    Some(String::new())
                ],
                vec![
                    Some("3".into()),
                    Some("Bia".into()),
                    Some("41".into()),
                    Some("say \"hi\"\nbye".into())
                ],
            ]
        );

        // a NULL name on line 650, in the second batch: the first batch is undone too
        let mut bad = String::from("id,nome\n");
        for id in 2001..=2700 {
            match id {
                2649 => writeln!(bad, "{id},").unwrap(),
                id => writeln!(bad, "{id},Q").unwrap(),
            }
        }
        let bad = db.file("bad.csv", &bad);
        let error = db
            .import("i3", db.request(&bad, &["id", "name"]), true)
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Database(_)), "{error:?}");
        let message = error.to_string();
        assert!(message.starts_with("linha 650: "), "{message}");
        assert!(
            message.contains("name") && message.ends_with("Nada foi gravado"),
            "{message}"
        );
        assert_eq!(db.count().await, "1200");

        // a value the column cannot take names the line and the column
        let typed = db.file("typed.csv", "id,nome,idade\n9001,X,10\n9002,Y,abc\n");
        let error = db
            .import("i4", db.request(&typed, &["id", "name", "age"]), true)
            .await
            .unwrap_err();
        assert!(error.to_string().starts_with(type_error), "{error}");
        assert_eq!(db.count().await, "1200");

        // a malformed line is found before anything runs
        let ragged = db.file("ragged.csv", "id,nome\n1,a\n2\n");
        assert_eq!(
            db.import("i5", db.request(&ragged, &["id", "name"]), false)
                .await
                .unwrap_err()
                .to_string(),
            "linha 3: 1 campos, mas o cabeçalho tem 2"
        );

        let entries = db
            .history
            .search("import CSV", Some(&db.id), false, 10)
            .await
            .unwrap();
        assert_eq!(entries.len(), 3, "the runs, not the reviews");
        assert!(
            entries
                .iter()
                .any(|e| e.sql.contains("people.csv") && e.error.is_none())
        );
    }

    async fn create_people(db: &Db, int: &str) {
        db.run(&format!(
            "CREATE TABLE people (id {int} PRIMARY KEY, name varchar(40) NOT NULL, age {int}, note text)"
        ))
        .await;
    }

    #[tokio::test]
    async fn postgres_imports_csv_cancels_and_names_the_column() {
        let (_container, config) = crate::adapters::postgres::integration_tests::start().await;
        let db = Db::open(config, Some("postgres"), "public").await;
        create_people(&db, "int").await;
        imports_in_one_transaction(
            &db,
            "linha 3, coluna idade → age: invalid input syntax for ",
        )
        .await;

        // cancel stops the statement on the server and rolls back
        db.run(
            "CREATE FUNCTION slow() RETURNS trigger LANGUAGE plpgsql AS
             $$ BEGIN PERFORM pg_sleep(0.5); RETURN NULL; END $$;
             CREATE TRIGGER slow AFTER INSERT ON people FOR EACH STATEMENT EXECUTE FUNCTION slow()",
        )
        .await;
        let mut csv = String::from("id,nome\n");
        for id in 5001..=7000 {
            writeln!(csv, "{id},S").unwrap();
        }
        let path = db.file("slow.csv", &csv);
        let (result, cancelled) = tokio::join!(
            db.import("slow", db.request(&path, &["id", "name"]), true),
            async {
                tokio::time::sleep(Duration::from_millis(700)).await;
                sql::cancel_run(&db.registry, "slow").await
            }
        );
        cancelled.unwrap();
        assert_eq!(
            result.unwrap_err().to_string(),
            "importação cancelada: nada foi gravado"
        );
        assert_eq!(db.count().await, "1200");
    }

    #[tokio::test]
    async fn mysql_imports_csv() {
        let (_container, config) = crate::adapters::mysql::integration_tests::start().await;
        let db = Db::open(config, None, "test").await;
        create_people(&db, "int").await;
        // MySQL names the column in its own message
        imports_in_one_transaction(
            &db,
            "linha 3: Incorrect integer value: 'abc' for column 'age'",
        )
        .await;
    }

    #[tokio::test]
    async fn sqlite_imports_csv_cancels_between_batches_and_checks_the_mapping() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("app.db");
        std::fs::File::create(&file).unwrap();
        let config = crate::adapters::sqlite::integration_tests::config(&file);
        let db = Db::open(config.clone(), None, "main").await;
        // STRICT, so a wrong type is an error instead of a stored text
        db.run("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, note TEXT) STRICT")
            .await;
        imports_in_one_transaction(
            &db,
            "linha 3: cannot store TEXT value in INTEGER column people.age",
        )
        .await;

        // no server-side cancel: the import stops before its next batch
        let mut csv = String::from("id,nome\n");
        for id in 10_001..=200_000 {
            writeln!(csv, "{id},S").unwrap();
        }
        let path = db.file("big.csv", &csv);
        let (result, ()) = tokio::join!(
            db.import("big", db.request(&path, &["id", "name"]), true),
            async {
                while db.registry.running("big").is_none() {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
                sql::cancel_run(&db.registry, "big").await.unwrap();
            }
        );
        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert_eq!(db.count().await, "1200");

        let path = db.file("one.csv", "id,nome\n1,a\n");
        let wrong = |columns: &[&str]| db.request(&path, columns);
        for (request, message) in [
            (
                wrong(&["id", "nope"]),
                "a tabela people não tem a coluna nope",
            ),
            (
                wrong(&["name", "name"]),
                "a coluna name recebe mais de uma coluna do arquivo",
            ),
            (
                wrong(&[]),
                "escolha ao menos uma coluna do arquivo para importar",
            ),
            (
                wrong(&["id", "name", "age"]),
                "o arquivo não tem a coluna 3",
            ),
        ] {
            assert_eq!(
                db.import("m", request, false)
                    .await
                    .unwrap_err()
                    .to_string(),
                message
            );
        }
        let header_only = db.file("empty.csv", "id,nome\n");
        assert!(matches!(
            db.import("m", db.request(&header_only, &["id", "name"]), false)
                .await,
            Err(AppError::Validation(_))
        ));

        // somente leitura refuses before reading the file
        let read_only = Db::open(
            ConnectionConfig {
                read_only: true,
                ..config
            },
            None,
            "main",
        )
        .await;
        assert!(matches!(
            read_only
                .import("ro", read_only.request(&path, &["id", "name"]), false)
                .await,
            Err(AppError::ReadOnly(_))
        ));
    }
}
