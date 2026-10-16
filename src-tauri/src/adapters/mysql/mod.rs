mod cell;

#[cfg(test)]
mod integration_tests;

use std::time::Duration;

use sqlx::mysql::{
    MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlQueryResult, MySqlRow, MySqlSslMode,
};
use sqlx::{
    AssertSqlSafe, Column, Executor, MySql, Row, SqlSafeStr, Statement, TypeInfo, ValueRef,
};

use crate::adapters::dialect::Dialect;
use crate::adapters::sql_builder;
use crate::adapters::stream::{self, Engine, ScriptRun};
use crate::domain::{
    AppError, BrowseRequest, ColumnInfo, CompletionTable, ConnectionConfig, ForeignKeyInfo,
    IndexInfo, Relation, RelationKind, ResultColumn, RowBatch, SchemaInfo, TableStructure, Target,
    TlsMode,
};

const MAX_POOL_CONNECTIONS: u32 = 5;
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);
const SYSTEM_SCHEMAS: &str = "'mysql', 'information_schema', 'performance_schema', 'sys'";

pub struct MysqlAdapter {
    pool: MySqlPool,
    engine: MySqlEngine,
    dialect: Dialect,
    timeout_secs: u32,
}

#[derive(Clone)]
pub struct MySqlEngine {
    pool: MySqlPool,
}

fn result_column(column: &sqlx::mysql::MySqlColumn) -> (ResultColumn, cell::Kind) {
    let type_name = column.type_info().name();
    let kind = cell::kind(type_name);
    let result = ResultColumn {
        name: column.name().to_string(),
        type_name: type_name.to_lowercase(),
        editable: cell::is_editable(kind),
    };
    (result, kind)
}

impl Engine for MySqlEngine {
    type Db = MySql;

    async fn batch(&self, rows: Vec<MySqlRow>, has_more: bool) -> RowBatch {
        let Some(first) = rows.first() else {
            return RowBatch {
                columns: Vec::new(),
                rows: Vec::new(),
                has_more,
            };
        };
        let columns: Vec<(ResultColumn, cell::Kind)> =
            first.columns().iter().map(result_column).collect();
        let cells = rows
            .iter()
            .map(|row| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(index, (column, kind))| {
                        let is_null = row.try_get_raw(index).map_or(true, |value| value.is_null());
                        // text protocol: the raw bytes are the value as MySQL rendered it
                        let raw = (!is_null)
                            .then(|| row.try_get_unchecked::<Vec<u8>, _>(index).ok())
                            .flatten();
                        cell::to_cell(*kind, &column.type_name, raw.as_deref())
                    })
                    .collect()
            })
            .collect();
        RowBatch {
            columns: columns.into_iter().map(|(column, _)| column).collect(),
            rows: cells,
            has_more,
        }
    }

    fn rows_affected(result: &MySqlQueryResult) -> u64 {
        result.rows_affected()
    }

    async fn session_id(&self, conn: &mut sqlx::MySqlConnection) -> Result<i64, AppError> {
        let id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
            .fetch_one(conn)
            .await?;
        Ok(i64::try_from(id).unwrap_or_default())
    }

    async fn cancel(&self, session: i64) {
        // the id comes from CONNECTION_ID(): a number, safe to inline
        let _ = sqlx::raw_sql(AssertSqlSafe(format!("KILL QUERY {session}")))
            .execute(&self.pool)
            .await;
    }

    async fn describe(&self, sql: &str) -> Vec<ResultColumn> {
        match (&self.pool)
            .prepare(AssertSqlSafe(sql.to_string()).into_sql_str())
            .await
        {
            Ok(statement) => statement
                .columns()
                .iter()
                .map(|column| result_column(column).0)
                .collect(),
            Err(_) => Vec::new(),
        }
    }
}

impl MysqlAdapter {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<String>,
        read_only: bool,
    ) -> Result<Self, AppError> {
        let Target::Network {
            host,
            port,
            database,
            username,
        } = &config.target
        else {
            return Err(AppError::validation("MySQL precisa de host/porta"));
        };

        let mut options = MySqlConnectOptions::new()
            .host(host)
            .port(*port)
            .username(username)
            .ssl_mode(ssl_mode(config.tls.mode))
            // UTC makes TIMESTAMP text deterministic; never touch sql_mode: a client
            // must not change how the user's SQL behaves (sqlx adds PIPES_AS_CONCAT)
            .timezone(Some("+00:00".to_string()))
            .pipes_as_concat(false)
            .no_engine_substitution(false);
        if !database.is_empty() {
            options = options.database(database);
        }
        if let Some(password) = password {
            options = options.password(&password);
        }
        if let Some(ca) = &config.tls.ca_cert_path {
            options = options.ssl_ca(ca);
        }

        let pool = MySqlPoolOptions::new()
            .max_connections(MAX_POOL_CONNECTIONS)
            .acquire_timeout(ACQUIRE_TIMEOUT)
            .after_connect(move |conn, _| {
                Box::pin(async move {
                    if read_only {
                        conn.execute("SET SESSION TRANSACTION READ ONLY").await?;
                    }
                    Ok(())
                })
            })
            .connect_with(options)
            .await?;

        // string literals must match how this server reads backslashes
        let sql_mode: String = sqlx::query_scalar("SELECT CAST(@@SESSION.sql_mode AS CHAR)")
            .fetch_one(&pool)
            .await?;
        let dialect = Dialect::Mysql {
            backslash_escapes: !sql_mode.contains("NO_BACKSLASH_ESCAPES"),
        };

        Ok(Self {
            engine: MySqlEngine { pool: pool.clone() },
            pool,
            dialect,
            timeout_secs: config.timeout_secs,
        })
    }

    pub fn dialect(&self) -> Dialect {
        self.dialect
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }

    /// Databases are the schemas.
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(AssertSqlSafe(format!(
            r"SELECT CAST(s.SCHEMA_NAME AS CHAR), CAST(t.TABLE_NAME AS CHAR), CAST(t.TABLE_TYPE AS CHAR)
              FROM information_schema.SCHEMATA s
              LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
              WHERE s.SCHEMA_NAME NOT IN ({SYSTEM_SCHEMAS})
              ORDER BY s.SCHEMA_NAME, t.TABLE_NAME"
        )))
        .fetch_all(&self.pool)
        .await?;

        let mut schemas: Vec<SchemaInfo> = Vec::new();
        for (schema, table, table_type) in rows {
            if schemas.last().is_none_or(|s| s.name != schema) {
                schemas.push(SchemaInfo {
                    name: schema,
                    relations: Vec::new(),
                });
            }
            if let (Some(name), Some(table_type)) = (table, table_type) {
                let kind = if table_type.contains("VIEW") {
                    RelationKind::View
                } else {
                    RelationKind::Table
                };
                let current = schemas.last_mut().expect("pushed above");
                current.relations.push(Relation { name, kind });
            }
        }
        Ok(schemas)
    }

    pub async fn table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, AppError> {
        let columns = sqlx::query_as::<_, (String, String, i64, Option<String>, i64)>(
            r"SELECT CAST(COLUMN_NAME AS CHAR), CAST(COLUMN_TYPE AS CHAR), IS_NULLABLE = 'YES',
                     CAST(COLUMN_DEFAULT AS CHAR), COLUMN_KEY = 'PRI'
              FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY ORDINAL_POSITION",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);
        // one row per indexed column, grouped below (GROUP_CONCAT truncates at 1024)
        let index_columns = sqlx::query_as::<_, (String, i64, String)>(
            r"SELECT CAST(INDEX_NAME AS CHAR), NON_UNIQUE, CAST(COLUMN_NAME AS CHAR)
              FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);
        let key_columns = sqlx::query_as::<_, (String, String, String, String, String)>(
            r"SELECT CAST(CONSTRAINT_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR),
                     CAST(REFERENCED_TABLE_SCHEMA AS CHAR), CAST(REFERENCED_TABLE_NAME AS CHAR),
                     CAST(REFERENCED_COLUMN_NAME AS CHAR)
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
              ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);

        let (columns, index_columns, key_columns) =
            tokio::try_join!(columns, index_columns, key_columns)?;
        if columns.is_empty() {
            return Err(AppError::not_found(&format!("tabela {schema}.{table}")));
        }

        let mut indexes: Vec<(String, bool, Vec<String>)> = Vec::new();
        for (name, non_unique, column) in index_columns {
            match indexes.last_mut() {
                Some((last, _, columns)) if *last == name => columns.push(column),
                _ => indexes.push((name, non_unique == 0, vec![column])),
            }
        }
        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
        for (name, column, ref_schema, ref_table, ref_column) in key_columns {
            match foreign_keys.last_mut() {
                Some(last) if last.name == name => {
                    last.columns.push(column);
                    last.referenced_columns.push(ref_column);
                }
                _ => foreign_keys.push(ForeignKeyInfo {
                    name,
                    definition: String::new(),
                    columns: vec![column],
                    referenced_schema: ref_schema,
                    referenced_table: ref_table,
                    referenced_columns: vec![ref_column],
                }),
            }
        }
        for key in &mut foreign_keys {
            key.definition = format!(
                "FOREIGN KEY ({}) REFERENCES {}.{} ({})",
                key.columns.join(", "),
                key.referenced_schema,
                key.referenced_table,
                key.referenced_columns.join(", ")
            );
        }

        Ok(TableStructure {
            columns: columns
                .into_iter()
                .map(|(name, data_type, nullable, default, primary)| ColumnInfo {
                    name,
                    options: cell::options(&data_type),
                    data_type,
                    nullable: nullable != 0,
                    default,
                    is_primary_key: primary != 0,
                })
                .collect(),
            indexes: indexes
                .into_iter()
                .map(|(name, unique, columns)| {
                    let kind = match (name.as_str(), unique) {
                        ("PRIMARY", _) => "PRIMARY KEY",
                        (_, true) => "UNIQUE INDEX",
                        (_, false) => "INDEX",
                    };
                    IndexInfo {
                        definition: format!("{kind} ({})", columns.join(", ")),
                        name,
                    }
                })
                .collect(),
            foreign_keys,
        })
    }

    /// The column's definition as `SHOW CREATE TABLE` writes it (type, NULL, default,
    /// comment…), without the name: `MODIFY COLUMN` replaces all of it, so a change starts
    /// from the whole text instead of losing what it does not mention.
    pub async fn column_definition(
        &self,
        schema: &str,
        table: &str,
        column: &str,
    ) -> Result<String, AppError> {
        let row = sqlx::query(AssertSqlSafe(format!(
            "SHOW CREATE TABLE {}.{}",
            self.dialect.quote_ident(schema),
            self.dialect.quote_ident(table)
        )))
        .fetch_one(&self.pool)
        .await?;
        let create: String = row.try_get(1)?;
        let prefix = format!("{} ", self.dialect.quote_ident(column));
        create
            .lines()
            .find_map(|line| line.trim_start().strip_prefix(&prefix))
            .map(|definition| definition.trim_end_matches(',').to_string())
            .ok_or_else(|| AppError::not_found(&format!("coluna {column}")))
    }

    pub async fn completion_tables(&self) -> Result<Vec<CompletionTable>, AppError> {
        let rows: Vec<(String, String, String)> = sqlx::query_as(AssertSqlSafe(format!(
            r"SELECT CAST(TABLE_SCHEMA AS CHAR), CAST(TABLE_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR)
              FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA NOT IN ({SYSTEM_SCHEMAS})
              ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
        )))
        .fetch_all(&self.pool)
        .await?;

        let mut tables: Vec<CompletionTable> = Vec::new();
        for (schema, table, column) in rows {
            match tables.last_mut() {
                Some(last) if last.schema == schema && last.table == table => {
                    last.columns.push(column)
                }
                _ => tables.push(CompletionTable {
                    schema,
                    table,
                    columns: vec![column],
                }),
            }
        }
        Ok(tables)
    }

    pub async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
        let columns = sqlx::query_scalar(
            r"SELECT CAST(COLUMN_NAME AS CHAR) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
              ORDER BY SEQ_IN_INDEX",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        Ok(columns)
    }

    pub async fn browse(&self, request: &BrowseRequest) -> Result<RowBatch, AppError> {
        let primary_key = self.primary_key(&request.schema, &request.table).await?;
        let sql = sql_builder::browse_sql(self.dialect, request, &primary_key)?;
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
        stream::apply::<MySqlEngine>(&self.pool, statements).await
    }

    pub async fn cancel(&self, session: i64) {
        self.engine.cancel(session).await;
    }
}

fn ssl_mode(mode: TlsMode) -> MySqlSslMode {
    match mode {
        TlsMode::Disable => MySqlSslMode::Disabled,
        TlsMode::Prefer => MySqlSslMode::Preferred,
        TlsMode::Require => MySqlSslMode::Required,
        TlsMode::VerifyFull => MySqlSslMode::VerifyIdentity,
    }
}
