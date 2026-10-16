#[cfg(test)]
pub(crate) mod integration_tests;

use std::time::Duration;

use sqlx::sqlite::{
    SqliteColumn, SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteQueryResult, SqliteRow,
};
use sqlx::{
    AssertSqlSafe, Column, Executor, Row, SqlSafeStr, Sqlite, Statement, TypeInfo, ValueRef,
};

use crate::adapters::dialect::Dialect;
use crate::adapters::sql_builder;
use crate::adapters::stream::{self, Engine, ScriptRun};
use crate::domain::{
    AppError, BrowseRequest, Cell, ColumnInfo, CompletionTable, ConnectionConfig, ForeignKeyInfo,
    IndexInfo, Relation, RelationKind, ResultColumn, RowBatch, SchemaInfo, TableDdl,
    TableStructure, Target,
};

const MAX_POOL_CONNECTIONS: u32 = 5;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const PREVIEW_BYTES: usize = 32;

pub struct SqliteAdapter {
    pool: SqlitePool,
    engine: SqliteEngine,
    timeout_secs: u32,
}

#[derive(Clone)]
pub struct SqliteEngine {
    pool: SqlitePool,
}

fn result_column(column: &SqliteColumn) -> ResultColumn {
    let declared = column.type_info().name().to_lowercase();
    ResultColumn {
        name: column.name().to_string(),
        // any value can be written back as text, except into a BLOB column
        editable: declared != "blob",
        type_name: declared,
    }
}

/// SQLite types each value (not the column): read it by its storage class.
fn value_cell(row: &SqliteRow, index: usize) -> Cell {
    let Ok(value) = row.try_get_raw(index) else {
        return Cell::Null;
    };
    if value.is_null() {
        return Cell::Null;
    }
    let storage = value.type_info().name().to_string();
    match storage.as_str() {
        "INTEGER" => row
            .try_get_unchecked::<i64, _>(index)
            .map_or(Cell::Null, |v| Cell::Int(v.to_string())),
        "REAL" => match row.try_get_unchecked::<f64, _>(index) {
            Ok(v) if v.is_finite() => Cell::Float(v),
            Ok(v) => Cell::Unknown {
                type_name: "real".into(),
                text: v.to_string(),
            },
            Err(_) => Cell::Null,
        },
        "BLOB" => row
            .try_get_unchecked::<Vec<u8>, _>(index)
            .map_or(Cell::Null, |bytes| Cell::Bytes {
                len: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
                preview_hex: bytes
                    .iter()
                    .take(PREVIEW_BYTES)
                    .map(|b| format!("{b:02x}"))
                    .collect(),
            }),
        _ => row
            .try_get_unchecked::<String, _>(index)
            .map_or(Cell::Null, Cell::Text),
    }
}

impl Engine for SqliteEngine {
    type Db = Sqlite;

    async fn batch(&self, rows: Vec<SqliteRow>, has_more: bool) -> RowBatch {
        let columns = rows
            .first()
            .map(|row| row.columns().iter().map(result_column).collect())
            .unwrap_or_default();
        let cells = rows
            .iter()
            .map(|row| {
                (0..row.columns().len())
                    .map(|index| value_cell(row, index))
                    .collect()
            })
            .collect();
        RowBatch {
            columns,
            rows: cells,
            has_more,
        }
    }

    fn rows_affected(result: &SqliteQueryResult) -> u64 {
        result.rows_affected()
    }

    /// No server, no session to point at: cancelling is not possible (only timeout).
    async fn session_id(&self, _conn: &mut sqlx::SqliteConnection) -> Result<i64, AppError> {
        Ok(0)
    }

    async fn cancel(&self, _session: i64) {}

    async fn describe(&self, sql: &str) -> Vec<ResultColumn> {
        match (&self.pool)
            .prepare(AssertSqlSafe(sql.to_string()).into_sql_str())
            .await
        {
            Ok(statement) => statement.columns().iter().map(result_column).collect(),
            Err(_) => Vec::new(),
        }
    }
}

impl SqliteAdapter {
    pub const DIALECT: Dialect = Dialect::Sqlite;

    pub async fn connect(config: &ConnectionConfig, read_only: bool) -> Result<Self, AppError> {
        let Target::File { path } = &config.target else {
            return Err(AppError::validation(
                "SQLite precisa do caminho de um arquivo",
            ));
        };
        let options = SqliteConnectOptions::new()
            .filename(path)
            // a typo must not silently create an empty database
            .create_if_missing(false)
            .read_only(read_only)
            .foreign_keys(true)
            .busy_timeout(BUSY_TIMEOUT);
        let pool = SqlitePoolOptions::new()
            .max_connections(MAX_POOL_CONNECTIONS)
            .connect_with(options)
            .await?;
        Ok(Self {
            engine: SqliteEngine { pool: pool.clone() },
            pool,
            timeout_secs: config.timeout_secs,
        })
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }

    async fn schema_names(&self) -> Result<Vec<String>, AppError> {
        Ok(
            sqlx::query_scalar("SELECT name FROM pragma_database_list ORDER BY seq")
                .fetch_all(&self.pool)
                .await?,
        )
    }

    /// main, temp (when used) and attached databases.
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let mut schemas = Vec::new();
        for schema in self.schema_names().await? {
            let rows: Vec<(String, String)> = sqlx::query_as(AssertSqlSafe(format!(
                r"SELECT name, type FROM {}.sqlite_master
                  WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
                  ORDER BY name",
                Self::DIALECT.quote_ident(&schema)
            )))
            .fetch_all(&self.pool)
            .await?;
            schemas.push(SchemaInfo {
                name: schema,
                relations: rows
                    .into_iter()
                    .map(|(name, kind)| Relation {
                        name,
                        kind: if kind == "view" {
                            RelationKind::View
                        } else {
                            RelationKind::Table
                        },
                    })
                    .collect(),
            });
        }
        Ok(schemas)
    }

    pub async fn table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, AppError> {
        let columns = sqlx::query_as::<_, (String, String, i64, Option<String>, i64)>(
            r#"SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?1, ?2) ORDER BY cid"#,
        )
        .bind(table)
        .bind(schema)
        .fetch_all(&self.pool);
        let indexes =
            sqlx::query_as::<_, (String, String, Option<String>)>(AssertSqlSafe(format!(
                r#"SELECT il.name, il.origin, m.sql
               FROM pragma_index_list(?1, ?2) il
               LEFT JOIN {}.sqlite_master m ON m.type = 'index' AND m.name = il.name
               ORDER BY il.name"#,
                Self::DIALECT.quote_ident(schema)
            )))
            .bind(table)
            .bind(schema)
            .fetch_all(&self.pool);
        let foreign_keys = sqlx::query_as::<_, (i64, String, String, Option<String>)>(
            r#"SELECT id, "table", "from", "to" FROM pragma_foreign_key_list(?1, ?2) ORDER BY id, seq"#,
        )
        .bind(table)
        .bind(schema)
        .fetch_all(&self.pool);

        let (columns, indexes, key_columns) = tokio::try_join!(columns, indexes, foreign_keys)?;
        if columns.is_empty() {
            return Err(AppError::not_found(&format!("tabela {schema}.{table}")));
        }

        let mut grouped: Vec<(i64, String, Vec<String>, Vec<String>)> = Vec::new();
        for (id, target, from, to) in key_columns {
            // `to` is NULL when the FK points at the target's primary key implicitly
            let to = to.unwrap_or_default();
            match grouped.last_mut() {
                Some((last, _, froms, tos)) if *last == id => {
                    froms.push(from);
                    tos.push(to);
                }
                _ => grouped.push((id, target, vec![from], vec![to])),
            }
        }

        Ok(TableStructure {
            columns: columns
                .into_iter()
                .map(|(name, data_type, not_null, default, pk)| ColumnInfo {
                    name,
                    // no BOOLEAN storage class: a column declared so holds 1 and 0
                    options: if matches!(data_type.to_lowercase().as_str(), "boolean" | "bool") {
                        vec!["1".into(), "0".into()]
                    } else {
                        Vec::new()
                    },
                    data_type,
                    nullable: not_null == 0 && pk == 0,
                    default,
                    is_primary_key: pk > 0,
                })
                .collect(),
            indexes: indexes
                .into_iter()
                .map(|(name, origin, sql)| IndexInfo {
                    definition: sql.unwrap_or_else(|| match origin.as_str() {
                        "pk" => "PRIMARY KEY (automático)".to_string(),
                        _ => "UNIQUE (automático)".to_string(),
                    }),
                    name,
                })
                .collect(),
            foreign_keys: grouped
                .into_iter()
                .map(|(id, target, froms, tos)| {
                    // `to` is empty for every column, or for none
                    let referenced_columns: Vec<String> =
                        tos.into_iter().filter(|to| !to.is_empty()).collect();
                    ForeignKeyInfo {
                        name: format!("fk_{id}"),
                        definition: format!(
                            "FOREIGN KEY ({}) REFERENCES {target} ({})",
                            froms.join(", "),
                            referenced_columns.join(", ")
                        ),
                        columns: froms,
                        // SQLite foreign keys never leave their database
                        referenced_schema: schema.to_string(),
                        referenced_table: target,
                        referenced_columns,
                    }
                })
                .collect(),
        })
    }

    /// The text stored in `sqlite_master`, exactly as it was written: the table first,
    /// then its indexes and triggers. Automatic indexes (PK, UNIQUE) have no text.
    pub async fn ddl(&self, schema: &str, table: &str) -> Result<TableDdl, AppError> {
        let statements: Vec<String> = sqlx::query_scalar(AssertSqlSafe(format!(
            r"SELECT sql FROM {}.sqlite_master
              WHERE tbl_name = ?1 AND sql IS NOT NULL
              ORDER BY type NOT IN ('table', 'view'), type, name",
            Self::DIALECT.quote_ident(schema)
        )))
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        if statements.is_empty() {
            return Err(AppError::not_found(&format!("tabela {schema}.{table}")));
        }
        Ok(TableDdl {
            sql: statements
                .iter()
                .map(|statement| format!("{statement};"))
                .collect::<Vec<_>>()
                .join("\n\n"),
            reconstructed: false,
        })
    }

    pub async fn completion_tables(&self) -> Result<Vec<CompletionTable>, AppError> {
        let mut tables: Vec<CompletionTable> = Vec::new();
        for schema in self.schema_names().await? {
            let rows: Vec<(String, String)> = sqlx::query_as(AssertSqlSafe(format!(
                r"SELECT m.name, p.name
                  FROM {}.sqlite_master m
                  JOIN pragma_table_info(m.name, ?1) p
                  WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\'
                  ORDER BY m.name, p.cid",
                Self::DIALECT.quote_ident(&schema)
            )))
            .bind(&schema)
            .fetch_all(&self.pool)
            .await?;
            for (table, column) in rows {
                match tables.last_mut() {
                    Some(last) if last.schema == schema && last.table == table => {
                        last.columns.push(column);
                    }
                    _ => tables.push(CompletionTable {
                        schema: schema.clone(),
                        table,
                        columns: vec![column],
                    }),
                }
            }
        }
        Ok(tables)
    }

    /// Declared primary key only: a rowid table without one stays read-only.
    pub async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
        Ok(sqlx::query_scalar(
            "SELECT name FROM pragma_table_info(?1, ?2) WHERE pk > 0 ORDER BY pk",
        )
        .bind(table)
        .bind(schema)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn browse(&self, request: &BrowseRequest) -> Result<RowBatch, AppError> {
        let primary_key = self.primary_key(&request.schema, &request.table).await?;
        let sql = sql_builder::browse_sql(Self::DIALECT, request, &primary_key)?;
        stream::fetch_page(&self.engine, &self.pool, sql, request.page_size as usize).await
    }

    pub async fn run_script(
        &self,
        statements: &[String],
        batch_size: usize,
        on_started: impl FnOnce(i64),
    ) -> Result<ScriptRun, AppError> {
        stream::run_script(
            &self.engine,
            &self.pool,
            statements,
            batch_size,
            self.timeout_secs,
            on_started,
        )
        .await
    }

    pub async fn apply(&self, statements: &[String]) -> Result<u32, AppError> {
        stream::apply::<SqliteEngine>(&self.pool, statements).await
    }

    pub async fn begin(&self) -> Result<(sqlx::Transaction<'static, sqlx::Sqlite>, i64), AppError> {
        stream::begin(&self.engine, &self.pool).await
    }

    pub async fn cancel(&self, session: i64) {
        self.engine.cancel(session).await;
    }
}
