//! Script execution shared by the SQL engines: run every statement on one
//! connection, keep the first batch of each, stream the last one in batches
//! through a `Cursor`, cancel on timeout or when the cursor is abandoned. Engine specifics (turning rows into
//! cells, cancelling, session ids) come from the `Engine` trait.

use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, Instant};

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
        let expired = || AppError::result_closed();
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

/// Earlier statements keep their first batch for the UI up to this many; past it they
/// only count rows. The last one always keeps it, so 20 result tabs at most.
// ponytail: 20 × the batch size in rows held per run; lower it if memory ever shows up
pub const EARLIER_RESULTS_KEPT: usize = 19;

/// One statement of a script that ran (or failed).
pub struct StepRun {
    pub duration: Duration,
    /// the first batch (or the affected rows of a command); None past the limit or on failure
    pub first: Option<BatchRead>,
    /// rows read to the end (query) or affected (write); None while the last one streams
    pub row_count: Option<u64>,
}

/// Every statement that ran, the failed one included; the ones after it did not run.
pub struct ScriptSteps {
    pub steps: Vec<StepRun>,
    /// Some while the last statement has more rows to fetch
    pub cursor: Option<Cursor>,
    /// why the script stopped; the message says where, as `failed_at` writes it
    pub failure: Option<AppError>,
}

/// All or error, for callers that only want the last result (explain, schema changes,
/// export…): the first failing statement is the error.
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
    let run = run_steps(
        engine,
        pool,
        statements,
        &[],
        batch_size,
        timeout_secs,
        on_started,
    )
    .await?;
    if let Some(err) = run.failure {
        return Err(err);
    }
    let first = run
        .steps
        .into_iter()
        .last()
        .and_then(|step| step.first)
        .ok_or_else(AppError::result_closed)?;
    Ok(ScriptRun {
        first,
        cursor: run.cursor,
    })
}

/// Runs every statement on one connection, each with its result: earlier ones keep
/// their first batch and count the rest, the last one keeps streaming through a
/// `Cursor`. A failing statement stops the script and comes back as `failure`, with
/// the steps before it; `Err` is only for what fails before the first statement.
/// `reads[i]` says statement i may return rows: an empty earlier result is described
/// (to keep a SELECT's header) only then. `on_started` receives the session id so
/// the caller can cancel.
pub async fn run_steps<E>(
    engine: &E,
    pool: &Pool<E::Db>,
    statements: &[String],
    reads: &[bool],
    batch_size: usize,
    timeout_secs: u32,
    on_started: impl FnOnce(i64),
) -> Result<ScriptSteps, AppError>
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

    let total = statements.len();
    let mut steps = Vec::with_capacity(total);
    let mut kept = 0;
    for (index, statement) in init.iter().enumerate() {
        let started = Instant::now();
        let reads = reads.get(index).copied().unwrap_or(false);
        let read = with_timeout(
            engine,
            session,
            timeout_secs,
            read_earlier(engine, &mut conn, statement, batch_size, reads),
        )
        .await;
        match read {
            Ok((first, row_count)) => {
                let has_rows = !first.batch.columns.is_empty();
                let keep = !has_rows || kept < EARLIER_RESULTS_KEPT;
                if has_rows && keep {
                    kept += 1;
                }
                steps.push(StepRun {
                    duration: started.elapsed(),
                    first: keep.then_some(first),
                    row_count: Some(row_count),
                });
            }
            Err(err) => {
                if matches!(err, AppError::Timeout(_)) {
                    // dropped mid-protocol: the connection is not reusable
                    conn.close_on_drop();
                }
                steps.push(StepRun {
                    duration: started.elapsed(),
                    first: None,
                    row_count: None,
                });
                return Ok(ScriptSteps {
                    steps,
                    cursor: None,
                    failure: Some(failed_at(err, index, total)),
                });
            }
        }
    }

    let started = Instant::now();
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

    let mut first = match with_timeout(engine, session, timeout_secs, cursor.next()).await {
        Ok(first) => first,
        Err(err) => {
            steps.push(StepRun {
                duration: started.elapsed(),
                first: None,
                row_count: None,
            });
            return Ok(ScriptSteps {
                steps,
                cursor: None,
                failure: Some(failed_at(err, init.len(), total)),
            });
        }
    };
    if first.batch.rows.is_empty() && first.batch.columns.is_empty() {
        first.batch.columns = engine.describe(last).await;
    }
    let row_count = (!first.batch.has_more).then(|| {
        if first.batch.columns.is_empty() {
            first.rows_affected.unwrap_or(0)
        } else {
            first.batch.rows.len() as u64
        }
    });
    let cursor = first.batch.has_more.then_some(cursor);
    steps.push(StepRun {
        duration: started.elapsed(),
        first: Some(first),
        row_count,
    });
    Ok(ScriptSteps {
        steps,
        cursor,
        failure: None,
    })
}

/// A statement before the last: its first batch, then read to its end to count the
/// rest (what `execute` did anyway, minus keeping rows). Reading to the end also
/// lets MySQL mark the connection idle, as `drain` explains.
async fn read_earlier<E>(
    engine: &E,
    conn: &mut PoolConnection<E::Db>,
    sql: &str,
    batch_size: usize,
    reads: bool,
) -> Result<(BatchRead, u64), AppError>
where
    E: Engine,
    for<'c> &'c mut <E::Db as Database>::Connection: Executor<'c, Database = E::Db>,
{
    let mut stream = sqlx::raw_sql(AssertSqlSafe(sql.to_string()))
        .fetch_many(&mut **conn)
        .peekable();
    let mut first = read_batch(Pin::new(&mut stream), batch_size, engine).await?;
    let mut rows = first.batch.rows.len() as u64;
    let mut affected = first.rows_affected.unwrap_or(0);
    while let Some(item) = stream.next().await {
        match item? {
            Either::Right(_) => rows += 1,
            Either::Left(done) => affected = E::rows_affected(&done),
        }
    }
    drop(stream);
    // a write with no rows skips the round trip; a SELECT matching nothing keeps its header
    if reads && rows == 0 && first.batch.columns.is_empty() {
        first.batch.columns = engine.describe(sql).await;
    }
    let count = if first.batch.columns.is_empty() {
        affected
    } else {
        rows
    };
    Ok((first, count))
}

/// A script stops at its first failing statement, and the ones before it already ran:
/// each is committed on its own unless the script opened a transaction itself. The
/// message says where it stopped and what that means, like the imports do.
fn failed_at(err: AppError, index: usize, total: usize) -> AppError {
    if total < 2 {
        return err;
    }
    let position = index + 1;
    let before = match index {
        0 => "Nada rodou antes dele".to_string(),
        1 => "O comando anterior já rodou e, sem BEGIN no script, já foi confirmado".to_string(),
        n => format!(
            "Os {n} comandos anteriores já rodaram e, sem BEGIN no script, já foram confirmados"
        ),
    };
    err.map_message(|message| format!("comando {position} de {total}: {message}. {before}"))
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

/// A transaction on its own connection, with that session's id so it can be cancelled.
pub async fn begin<E>(
    engine: &E,
    pool: &Pool<E::Db>,
) -> Result<(sqlx::Transaction<'static, E::Db>, i64), AppError>
where
    E: Engine,
{
    let mut tx = pool.begin().await?;
    let session = engine.session_id(&mut tx).await?;
    Ok((tx, session))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_script_says_where_it_stopped_and_what_already_ran() {
        let err = || AppError::Database("syntax error at or near \"FROMM\" [42601]".to_string());

        // one statement: the driver's message as it is
        assert_eq!(
            failed_at(err(), 0, 1).to_string(),
            "syntax error at or near \"FROMM\" [42601]"
        );
        assert_eq!(
            failed_at(err(), 0, 3).to_string(),
            "comando 1 de 3: syntax error at or near \"FROMM\" [42601]. Nada rodou antes dele"
        );
        assert_eq!(
            failed_at(err(), 1, 3).to_string(),
            "comando 2 de 3: syntax error at or near \"FROMM\" [42601]. O comando anterior já rodou e, sem BEGIN no script, já foi confirmado"
        );
        assert_eq!(
            failed_at(err(), 2, 5).to_string(),
            "comando 3 de 5: syntax error at or near \"FROMM\" [42601]. Os 2 comandos anteriores já rodaram e, sem BEGIN no script, já foram confirmados"
        );
        // the kind survives: the UI still reads a cancel as a cancel
        assert!(matches!(
            failed_at(AppError::cancelled(), 2, 5),
            AppError::Cancelled(message) if message.starts_with("comando 3 de 5: query cancelada")
        ));
    }
}
