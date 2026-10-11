pub mod csv;
pub mod dialect;
pub mod mongo;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod split;
pub mod sql_builder;
pub mod sqlite;
pub mod stream;

use crate::domain::{
    AppError, BrowseRequest, CompletionTable, ConnectionConfig, Engine, RowBatch, SchemaInfo,
    TableStructure,
};
use dialect::Dialect;
use mysql::MysqlAdapter;
use postgres::PostgresAdapter;
use sqlite::SqliteAdapter;
use stream::ScriptRun;

/// An open SQL database. An enum rather than `Box<dyn SqlAdapter>`: the engines are
/// a closed set, and async methods behind `dyn` would need boxed futures. The three
/// adapters expose the same methods; `each!` forwards to the right one.
pub enum SqlConnection {
    Postgres(PostgresAdapter),
    Mysql(MysqlAdapter),
    Sqlite(SqliteAdapter),
}

macro_rules! each {
    ($connection:expr, $adapter:ident => $call:expr) => {
        match $connection {
            SqlConnection::Postgres($adapter) => $call,
            SqlConnection::Mysql($adapter) => $call,
            SqlConnection::Sqlite($adapter) => $call,
        }
    };
}

impl SqlConnection {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<String>,
        read_only: bool,
    ) -> Result<Self, AppError> {
        match config.engine {
            Engine::Postgres => Ok(SqlConnection::Postgres(
                PostgresAdapter::connect(config, password, read_only).await?,
            )),
            Engine::Mysql => Ok(SqlConnection::Mysql(
                MysqlAdapter::connect(config, password, read_only).await?,
            )),
            Engine::Sqlite => Ok(SqlConnection::Sqlite(
                SqliteAdapter::connect(config, read_only).await?,
            )),
            Engine::Mongo | Engine::Redis => Err(AppError::validation(format!(
                "{} não é um banco SQL",
                config.name
            ))),
        }
    }

    pub fn dialect(&self) -> Dialect {
        match self {
            SqlConnection::Postgres(_) => PostgresAdapter::DIALECT,
            SqlConnection::Mysql(adapter) => adapter.dialect(),
            SqlConnection::Sqlite(_) => SqliteAdapter::DIALECT,
        }
    }

    pub async fn close(&self) {
        each!(self, adapter => adapter.close().await)
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        each!(self, adapter => adapter.list_schemas().await)
    }

    pub async fn table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, AppError> {
        each!(self, adapter => adapter.table_structure(schema, table).await)
    }

    pub async fn completion_tables(&self) -> Result<Vec<CompletionTable>, AppError> {
        each!(self, adapter => adapter.completion_tables().await)
    }

    pub async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
        each!(self, adapter => adapter.primary_key(schema, table).await)
    }

    pub async fn browse(&self, request: &BrowseRequest) -> Result<RowBatch, AppError> {
        each!(self, adapter => adapter.browse(request).await)
    }

    pub async fn run_script(
        &self,
        statements: &[String],
        batch_size: usize,
        on_started: impl FnOnce(i64),
    ) -> Result<ScriptRun, AppError> {
        each!(self, adapter => adapter.run_script(statements, batch_size, on_started).await)
    }

    pub async fn apply(&self, statements: &[String]) -> Result<u32, AppError> {
        each!(self, adapter => adapter.apply(statements).await)
    }

    pub async fn cancel(&self, session: i64) {
        each!(self, adapter => adapter.cancel(session).await)
    }
}
