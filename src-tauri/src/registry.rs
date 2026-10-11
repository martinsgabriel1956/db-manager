use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use crate::adapters::SqlConnection;
use crate::adapters::stream::Cursor;
use crate::domain::{AppError, Environment};

// The locks guard plain maps and are never held across an await.

/// An open session plus the connection settings the write rules depend on.
pub struct OpenConnection {
    pub adapter: SqlConnection,
    pub name: String,
    pub environment: Environment,
    pub read_only: bool,
}

/// A running script: which backend to cancel.
struct Run {
    connection: Arc<OpenConnection>,
    session: i64,
}

struct OpenCursor {
    connection_id: String,
    cursor: Arc<Cursor>,
}

/// Open connections, running scripts (for cancel) and open result cursors.
#[derive(Default)]
pub struct Registry {
    connections: Mutex<HashMap<String, Arc<OpenConnection>>>,
    runs: Mutex<HashMap<String, Run>>,
    cursors: Mutex<HashMap<String, OpenCursor>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Registry {
    pub fn is_connected(&self, connection_id: &str) -> bool {
        lock(&self.connections).contains_key(connection_id)
    }

    pub fn insert_connection(&self, connection_id: &str, connection: OpenConnection) {
        lock(&self.connections).insert(connection_id.to_string(), Arc::new(connection));
    }

    pub fn connection(&self, connection_id: &str) -> Result<Arc<OpenConnection>, AppError> {
        lock(&self.connections)
            .get(connection_id)
            .cloned()
            .ok_or_else(|| AppError::not_connected(connection_id))
    }

    /// Removes the connection and drops its cursors first: each cursor holds a pool
    /// connection, and closing the pool waits for all of them to come back.
    pub fn remove_connection(&self, connection_id: &str) -> Option<Arc<OpenConnection>> {
        lock(&self.cursors).retain(|_, open| open.connection_id != connection_id);
        lock(&self.connections).remove(connection_id)
    }

    pub fn start_run(&self, run_id: &str, connection: Arc<OpenConnection>, session: i64) {
        lock(&self.runs).insert(
            run_id.to_string(),
            Run {
                connection,
                session,
            },
        );
    }

    pub fn finish_run(&self, run_id: &str) {
        lock(&self.runs).remove(run_id);
    }

    pub fn running(&self, run_id: &str) -> Option<(Arc<OpenConnection>, i64)> {
        lock(&self.runs)
            .get(run_id)
            .map(|run| (run.connection.clone(), run.session))
    }

    pub fn insert_cursor(&self, cursor_id: &str, connection_id: &str, cursor: Cursor) {
        lock(&self.cursors).insert(
            cursor_id.to_string(),
            OpenCursor {
                connection_id: connection_id.to_string(),
                cursor: Arc::new(cursor),
            },
        );
    }

    pub fn cursor(&self, cursor_id: &str) -> Result<Arc<Cursor>, AppError> {
        lock(&self.cursors)
            .get(cursor_id)
            .map(|open| open.cursor.clone())
            .ok_or_else(|| AppError::not_found("resultado (já foi fechado)"))
    }

    pub fn remove_cursor(&self, cursor_id: &str) {
        lock(&self.cursors).remove(cursor_id);
    }
}
