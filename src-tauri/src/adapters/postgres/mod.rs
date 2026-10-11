mod cell;

#[cfg(test)]
pub(crate) mod integration_tests;

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use sqlx::postgres::{
    PgColumn, PgConnectOptions, PgPool, PgPoolOptions, PgQueryResult, PgRow, PgSslMode,
};
use sqlx::{AssertSqlSafe, Column, Executor, Postgres, Row, SqlSafeStr, Statement, ValueRef};

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

pub struct PostgresAdapter {
    pool: PgPool,
    engine: PgEngine,
    timeout_secs: u32,
}

/// Turns rows into cells. Custom types (enums, domains) arrive unresolved on the
/// text protocol, so their pg_type facts are looked up once and cached.
#[derive(Clone)]
pub struct PgEngine {
    pool: PgPool,
    catalog: Arc<Mutex<cell::Catalog>>,
}

impl PgEngine {
    async fn resolve(&self, columns: &[PgColumn]) -> Vec<(ResultColumn, cell::ValueType)> {
        let missing: Vec<i64> = {
            let catalog = self.catalog.lock().unwrap_or_else(PoisonError::into_inner);
            columns
                .iter()
                .filter_map(|c| cell::unresolved_oid(c.type_info()))
                .filter(|oid| !catalog.contains_key(oid))
                .map(i64::from)
                .collect()
        };
        if !missing.is_empty() {
            // best effort: an unresolved type is still shown, as Unknown
            if let Ok(found) = self.lookup(&missing).await {
                let mut catalog = self.catalog.lock().unwrap_or_else(PoisonError::into_inner);
                catalog.extend(found);
            }
        }

        let catalog = self.catalog.lock().unwrap_or_else(PoisonError::into_inner);
        columns
            .iter()
            .map(|column| {
                let value_type = cell::resolve(column.type_info(), &catalog);
                let result_column = ResultColumn {
                    name: column.name().to_string(),
                    type_name: cell::type_name(column.type_info(), &catalog),
                    editable: cell::is_editable(&value_type),
                };
                (result_column, value_type)
            })
            .collect()
    }

    async fn lookup(&self, oids: &[i64]) -> Result<Vec<(u32, cell::CustomType)>, AppError> {
        let rows: Vec<(i64, String, String, i64)> = sqlx::query_as(
            r"SELECT oid::int8, format_type(oid, NULL), typtype::text, typbasetype::int8
              FROM pg_type WHERE oid::int8 = ANY($1)",
        )
        .bind(oids)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(oid, name, typtype, base)| {
                let kind = match typtype.as_str() {
                    "e" => cell::CustomKind::Enum,
                    "d" => cell::CustomKind::Domain(u32::try_from(base).unwrap_or(0)),
                    _ => cell::CustomKind::Other,
                };
                (
                    u32::try_from(oid).unwrap_or(0),
                    cell::CustomType { name, kind },
                )
            })
            .collect())
    }
}

impl Engine for PgEngine {
    type Db = Postgres;

    async fn batch(&self, rows: Vec<PgRow>, has_more: bool) -> RowBatch {
        let Some(first) = rows.first() else {
            return RowBatch {
                columns: Vec::new(),
                rows: Vec::new(),
                has_more,
            };
        };
        let resolved = self.resolve(first.columns()).await;
        let cells = rows
            .iter()
            .map(|row| {
                resolved
                    .iter()
                    .enumerate()
                    .map(|(index, (column, value_type))| {
                        let text = row
                            .try_get_raw(index)
                            .ok()
                            .filter(|value| !value.is_null())
                            .and_then(|value| value.as_str().ok().map(str::to_owned));
                        cell::to_cell(value_type, &column.type_name, text.as_deref())
                    })
                    .collect()
            })
            .collect();
        RowBatch {
            columns: resolved.into_iter().map(|(column, _)| column).collect(),
            rows: cells,
            has_more,
        }
    }

    fn rows_affected(result: &PgQueryResult) -> u64 {
        result.rows_affected()
    }

    async fn session_id(&self, conn: &mut sqlx::PgConnection) -> Result<i64, AppError> {
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(conn)
            .await?;
        Ok(i64::from(pid))
    }

    async fn cancel(&self, session: i64) {
        // best effort: the caller reports the timeout/abandon either way
        let _ = sqlx::query("SELECT pg_cancel_backend($1)")
            .bind(i32::try_from(session).unwrap_or_default())
            .execute(&self.pool)
            .await;
    }

    /// Runs on another connection, so statements depending on session state just
    /// get no columns.
    async fn describe(&self, sql: &str) -> Vec<ResultColumn> {
        let Ok(statement) = (&self.pool)
            .prepare(AssertSqlSafe(sql.to_string()).into_sql_str())
            .await
        else {
            return Vec::new();
        };
        self.resolve(statement.columns())
            .await
            .into_iter()
            .map(|(column, _)| column)
            .collect()
    }
}

impl PostgresAdapter {
    pub const DIALECT: Dialect = Dialect::Postgres;

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
            return Err(AppError::validation("Postgres precisa de host/porta"));
        };

        // ISO dates and UTC make the text values deterministic (see cell.rs);
        // hex bytea is what bytea_to_cell parses.
        let mut session = vec![
            ("DateStyle", "ISO"),
            ("TimeZone", cell::SESSION_TIME_ZONE),
            ("bytea_output", "hex"),
        ];
        // set only when on: forcing "off" would override a read-only role default
        if read_only {
            session.push(("default_transaction_read_only", "on"));
        }

        let mut options = PgConnectOptions::new()
            .host(host)
            .port(*port)
            .username(username)
            .application_name("db-manager")
            .ssl_mode(ssl_mode(config.tls.mode))
            .options(session);
        if !database.is_empty() {
            options = options.database(database);
        }
        if let Some(password) = password {
            options = options.password(&password);
        }
        if let Some(ca) = &config.tls.ca_cert_path {
            options = options.ssl_root_cert(ca);
        }

        let pool = PgPoolOptions::new()
            .max_connections(MAX_POOL_CONNECTIONS)
            .acquire_timeout(ACQUIRE_TIMEOUT)
            .connect_with(options)
            .await?;
        Ok(Self {
            engine: PgEngine {
                pool: pool.clone(),
                catalog: Arc::default(),
            },
            pool,
            timeout_secs: config.timeout_secs,
        })
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            r"SELECT n.nspname::text, c.relname::text, c.relkind::text
              FROM pg_namespace n
              LEFT JOIN pg_class c ON c.relnamespace = n.oid
                AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
              WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
              ORDER BY n.nspname, c.relname",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut schemas: Vec<SchemaInfo> = Vec::new();
        for (schema, relation, kind) in rows {
            if schemas.last().is_none_or(|s| s.name != schema) {
                schemas.push(SchemaInfo {
                    name: schema,
                    relations: Vec::new(),
                });
            }
            if let (Some(name), Some(kind)) = (relation, kind) {
                let current = schemas.last_mut().expect("pushed above");
                current.relations.push(Relation {
                    name,
                    kind: relation_kind(&kind),
                });
            }
        }
        Ok(schemas)
    }

    pub async fn table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, AppError> {
        let columns = sqlx::query_as::<_, (String, String, bool, Option<String>, bool)>(
            r"SELECT a.attname::text, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                     pg_get_expr(d.adbin, d.adrelid), COALESCE(a.attnum = ANY(i.indkey::int2[]), false)
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
              WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);
        let indexes = sqlx::query_as::<_, (String, String)>(
            r"SELECT indexname::text, indexdef FROM pg_indexes
              WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);
        let foreign_keys = sqlx::query_as::<_, (String, String)>(
            r"SELECT con.conname::text, pg_get_constraintdef(con.oid)
              FROM pg_constraint con
              JOIN pg_class c ON c.oid = con.conrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2
              ORDER BY con.conname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool);

        let (columns, indexes, foreign_keys) = tokio::try_join!(columns, indexes, foreign_keys)?;
        if columns.is_empty() {
            return Err(AppError::not_found(&format!("tabela {schema}.{table}")));
        }

        Ok(TableStructure {
            columns: columns
                .into_iter()
                .map(
                    |(name, data_type, nullable, default, is_primary_key)| ColumnInfo {
                        name,
                        data_type,
                        nullable,
                        default,
                        is_primary_key,
                    },
                )
                .collect(),
            indexes: indexes
                .into_iter()
                .map(|(name, definition)| IndexInfo { name, definition })
                .collect(),
            foreign_keys: foreign_keys
                .into_iter()
                .map(|(name, definition)| ForeignKeyInfo { name, definition })
                .collect(),
        })
    }

    pub async fn completion_tables(&self) -> Result<Vec<CompletionTable>, AppError> {
        let rows: Vec<(String, String, Vec<String>)> = sqlx::query_as(
            r"SELECT n.nspname::text, c.relname::text, array_agg(a.attname::text ORDER BY a.attnum)
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
              WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
                AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
              GROUP BY n.nspname, c.relname
              ORDER BY n.nspname, c.relname",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(schema, table, columns)| CompletionTable {
                schema,
                table,
                columns,
            })
            .collect())
    }

    /// Primary-key columns in key order; empty for tables without one and for views.
    pub async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
        let columns = sqlx::query_scalar(
            r"SELECT a.attname::text
              FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::int2[])
              WHERE i.indisprimary
                AND i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
              ORDER BY array_position(i.indkey::int2[], a.attnum)",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        Ok(columns)
    }

    /// Primary key first (stable default ordering), then the page itself.
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
        stream::apply::<PgEngine>(&self.pool, statements).await
    }

    pub async fn cancel(&self, session: i64) {
        self.engine.cancel(session).await;
    }
}

fn relation_kind(relkind: &str) -> RelationKind {
    match relkind {
        "v" => RelationKind::View,
        "m" => RelationKind::MaterializedView,
        "f" => RelationKind::ForeignTable,
        _ => RelationKind::Table,
    }
}

fn ssl_mode(mode: TlsMode) -> PgSslMode {
    match mode {
        TlsMode::Disable => PgSslMode::Disable,
        TlsMode::Prefer => PgSslMode::Prefer,
        TlsMode::Require => PgSslMode::Require,
        TlsMode::VerifyFull => PgSslMode::VerifyFull,
    }
}
