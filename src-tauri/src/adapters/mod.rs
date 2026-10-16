pub mod csv;
pub mod dialect;
pub mod mongo;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod split;
pub mod sql_builder;
pub mod sqlite;
pub mod ssh;
pub mod stream;

use crate::domain::{
    AppError, BrowseRequest, CompletionTable, ConnectionConfig, Engine, RowBatch, SchemaInfo,
    TableStructure,
};
use dialect::Dialect;
use mysql::MysqlAdapter;
use postgres::PostgresAdapter;
use sqlite::SqliteAdapter;
use sqlx::{AssertSqlSafe, MySql, Postgres, Sqlite, Transaction};
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

    /// A transaction on a connection of its own, plus the session id to cancel it by.
    pub async fn begin(&self) -> Result<(SqlTransaction, i64), AppError> {
        Ok(match self {
            SqlConnection::Postgres(adapter) => {
                let (tx, session) = adapter.begin().await?;
                (SqlTransaction::Postgres(tx), session)
            }
            SqlConnection::Mysql(adapter) => {
                let (tx, session) = adapter.begin().await?;
                (SqlTransaction::Mysql(tx), session)
            }
            SqlConnection::Sqlite(adapter) => {
                let (tx, session) = adapter.begin().await?;
                (SqlTransaction::Sqlite(tx), session)
            }
        })
    }
}

/// An open transaction; dropping it without `commit` rolls back.
pub enum SqlTransaction {
    Postgres(Transaction<'static, Postgres>),
    Mysql(Transaction<'static, MySql>),
    Sqlite(Transaction<'static, Sqlite>),
}

impl SqlTransaction {
    /// Runs one statement as text. The error stays a `sqlx::Error`, so the caller can
    /// read where in the statement it happened (`error_position`).
    pub async fn execute(&mut self, statement: &str) -> Result<(), sqlx::Error> {
        let statement = sqlx::raw_sql(AssertSqlSafe(statement.to_string()));
        match self {
            SqlTransaction::Postgres(tx) => statement.execute(&mut **tx).await.map(drop),
            SqlTransaction::Mysql(tx) => statement.execute(&mut **tx).await.map(drop),
            SqlTransaction::Sqlite(tx) => statement.execute(&mut **tx).await.map(drop),
        }
    }

    pub async fn commit(self) -> Result<(), AppError> {
        match self {
            SqlTransaction::Postgres(tx) => tx.commit().await?,
            SqlTransaction::Mysql(tx) => tx.commit().await?,
            SqlTransaction::Sqlite(tx) => tx.commit().await?,
        }
        Ok(())
    }
}

/// The 1-based character offset PostgreSQL reports for an error in a statement
/// (a value it cannot convert); MySQL and SQLite name the column in the message.
pub fn error_position(err: &sqlx::Error) -> Option<usize> {
    match err
        .as_database_error()?
        .try_downcast_ref::<sqlx::postgres::PgDatabaseError>()?
        .position()?
    {
        sqlx::postgres::PgErrorPosition::Original(position) => Some(position),
        sqlx::postgres::PgErrorPosition::Internal { .. } => None,
    }
}
