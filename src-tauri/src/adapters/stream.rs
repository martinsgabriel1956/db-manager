//! Script execution shared by the SQL engines: run every statement on one
//! connection, stream the last one in batches through a `Cursor`, cancel on
//! timeout or when the cursor is abandoned. Engine specifics (turning rows into
//! cells, cancelling, session ids) come from the `Engine` trait.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream::{BoxStream, Peekable};
use sqlx::pool::PoolConnection;
use sqlx::{AssertSqlSafe, Database, Either, Executor, Pool};
use tokio::sync::{mpsc, oneshot};

use crate::domain::{AppError, ResultColumn, RowBatch};

type RowStream<'c, Db> = Peekable<
    BoxStream<
        'c,
        Result<Either<<Db as Database>::QueryResult, <Db as Database>::Row>, sqlx::Error>,
    >,
>;
type BatchReply = oneshot::Sender<Result<BatchRead, AppError>>;

pub trait Engine: Clone + Send + Sync + 'static {
    type Db: Database;

    fn batch(
        &self,
        rows: Vec<<Self::Db as Database>::Row>,
        has_more: bool,
    ) -> impl Future<Output = RowBatch> + Send;

    fn rows_affected(result: &<Self::Db as Database>::QueryResult) -> u64;

    /// Identifies the session so another connection can cancel its statement.
    fn session_id(
        &self,
        conn: &mut <Self::Db as Database>::Connection,
    ) -> impl Future<Output = Result<i64, AppError>> + Send;

    /// Best effort: stop the statement running on that session.
    fn cancel(&self, session: i64) -> impl Future<Output = ()> + Send;

    /// Columns of a statement that returned no rows, so an empty SELECT keeps its header.
    fn describe(&self, sql: &str) -> impl Future<Output = Vec<ResultColumn>> + Send;
}

/// One batch of rows, plus the affected-row count once the statement completed.
#[derive(Debug)]
pub struct BatchRead {
    pub batch: RowBatch,
    pub rows_affected: Option<u64>,
}

/// Handle to the last statement of a script, still streaming on its own connection.
/// Dropping it cancels the query and discards that connection.
pub struct Cursor {
    requests: mpsc::Sender<BatchReply>,
}

impl Cursor {
    pub async fn next(&self) -> Result<BatchRead, AppError> {
        let expired = || AppError::not_found("resultado (já foi fechado)");
        let (reply, response) = oneshot::channel();
        self.requests.send(reply).await.map_err(|_| expired())?;
        response.await.map_err(|_| expired())?
    }
}

pub struct ScriptRun {
    pub first: BatchRead,
    /// Some while the last statement has more rows to fetch
    pub cursor: Option<Cursor>,
}

/// Runs every statement on one connection; the last one keeps streaming through a
/// `Cursor`. `on_started` receives the session id so the caller can cancel.
pub async fn run_script<E>(
    engine: &E,
    pool: &Pool<E::Db>,
    statements: &[String],
    batch_size: usize,
    timeout_secs: u32,
    on_started: impl FnOnce(i64),
) -> Result<ScriptRun, AppError>
where
    E: Engine,
    for<'c> &'c mut <E::Db as Database>::Connection: Executor<'c, Database = E::Db>,
{
    let (last, init) = statements
        .split_last()
        .ok_or_else(|| AppError::validation("nenhum comando para executar"))?;

    let mut conn = pool.acquire().await?;
    let session = engine.session_id(&mut conn).await?;
    on_started(session);

    for statement in init {
        let execution = async {
            sqlx::raw_sql(AssertSqlSafe(statement.clone()))
                .execute(&mut *conn)
                .await
                .map(|_| ())
                .map_err(AppError::from)
        };
        if let Err(err) = with_timeout(engine, session, timeout_secs, execution).await {
            if matches!(err, AppError::Timeout(_)) {
                // dropped mid-protocol: the connection is not reusable
                conn.close_on_drop();
            }
            return Err(err);
        }
    }

    let (requests, receiver) = mpsc::channel(1);
    tokio::spawn(stream_task(
        engine.clone(),
        conn,
        session,
        last.clone(),
        batch_size,
        receiver,
    ));
    let cursor = Cursor { requests };

    let mut first = with_timeout(engine, session, timeout_secs, cursor.next()).await?;
    if first.batch.rows.is_empty() && first.batch.columns.is_empty() {
        first.batch.columns = engine.describe(last).await;
    }
    let cursor = first.batch.has_more.then_some(cursor);
    Ok(ScriptRun { first, cursor })
}

/// One page of a query that is read to its end right away (table browsing).
pub async fn fetch_page<E>(
    engine: &E,
    pool: &Pool<E::Db>,
    sql: String,
    limit: usize,
) -> Result<RowBatch, AppError>
where
    E: Engine,
    for<'p> &'p Pool<E::Db>: Executor<'p, Database = E::Db>,
{
    let mut stream = sqlx::raw_sql(AssertSqlSafe(sql.clone()))
        .fetch_many(pool)
        .peekable();
    let read = read_batch(Pin::new(&mut stream), limit, engine).await;
    // bounded by the query's LIMIT: at most the peeked row and the end marker
    drain::<E::Db>(Pin::new(&mut stream)).await;
    let read = read?;
    let mut batch = read.batch;
    if batch.columns.is_empty() {
        batch.columns = engine.describe(&sql).await;
    }
    Ok(batch)
}

/// Runs staged-edit statements in one transaction. Each must touch exactly one row
/// (MySQL connections report matched rows, not changed ones); otherwise the row
/// changed under us and everything rolls back.
pub async fn apply<E>(pool: &Pool<E::Db>, statements: &[String]) -> Result<u32, AppError>
where
    E: Engine,
    for<'c> &'c mut <E::Db as Database>::Connection: Executor<'c, Database = E::Db>,
{
    let mut tx = pool.begin().await?;
    for statement in statements {
        let result = sqlx::raw_sql(AssertSqlSafe(statement.clone()))
            .execute(&mut *tx)
            .await?;
        if E::rows_affected(&result) != 1 {
            // dropping `tx` rolls back
            return Err(AppError::conflict());
        }
    }
    tx.commit().await?;
    Ok(u32::try_from(statements.len()).unwrap_or(u32::MAX))
}

async fn with_timeout<E: Engine, T>(
    engine: &E,
    session: i64,
    timeout_secs: u32,
    work: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    if timeout_secs == 0 {
        return work.await;
    }
    let limit = Duration::from_secs(u64::from(timeout_secs));
    match tokio::time::timeout(limit, work).await {
        Ok(result) => result,
        Err(_) => {
            engine.cancel(session).await;
            Err(AppError::timeout(timeout_secs))
        }
    }
}

/// Owns the connection and the row stream of the last statement, answering one
/// batch per request. When the cursor is dropped before the end, the statement is
/// cancelled and the connection discarded instead of drained.
async fn stream_task<E>(
    engine: E,
    mut conn: PoolConnection<E::Db>,
    session: i64,
    sql: String,
    batch_size: usize,
    mut requests: mpsc::Receiver<BatchReply>,
) where
    E: Engine,
    for<'c> &'c mut <E::Db as Database>::Connection: Executor<'c, Database = E::Db>,
{
    let mut finished = false;
    {
        let mut stream = sqlx::raw_sql(AssertSqlSafe(sql))
            .fetch_many(&mut *conn)
            .peekable();
        while let Some(reply) = requests.recv().await {
            let read = read_batch(Pin::new(&mut stream), batch_size, &engine).await;
            finished = read.as_ref().map_or(true, |r| !r.batch.has_more);
            let _ = reply.send(read);
            if finished {
                drain::<E::Db>(Pin::new(&mut stream)).await;
                break;
            }
        }
    }
    if !finished {
        engine.cancel(session).await;
        conn.close_on_drop();
    }
}

/// Reads a finished stream to its end before dropping it. sqlx only marks a MySQL
/// connection idle after the stream observes its end; dropped right after the last
/// result, the connection's release ping waits forever and the pool runs dry.
async fn drain<Db: Database>(mut stream: Pin<&mut RowStream<'_, Db>>) {
    while stream.next().await.is_some() {}
}

async fn read_batch<E: Engine>(
    mut stream: Pin<&mut RowStream<'_, E::Db>>,
    batch_size: usize,
    engine: &E,
) -> Result<BatchRead, AppError> {
    let mut rows = Vec::new();

    while rows.len() < batch_size {
        match stream.next().await {
            Some(Ok(Either::Right(row))) => rows.push(row),
            Some(Ok(Either::Left(done))) => {
                return Ok(BatchRead {
                    batch: engine.batch(rows, false).await,
                    rows_affected: Some(E::rows_affected(&done)),
                });
            }
            Some(Err(err)) => return Err(err.into()),
            None => {
                return Ok(BatchRead {
                    batch: engine.batch(rows, false).await,
                    rows_affected: None,
                });
            }
        }
    }

    // an error right after a full batch must surface on the next fetch, not vanish
    let has_more = matches!(
        stream.as_mut().peek().await,
        Some(Ok(Either::Right(_))) | Some(Err(_))
    );
    Ok(BatchRead {
        batch: engine.batch(rows, has_more).await,
        rows_affected: None,
    })
}
