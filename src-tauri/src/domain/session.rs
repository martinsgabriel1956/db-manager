use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::Confirmation;

/// What the sessions screen can do to a session; each engine supports some of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum KillAction {
    /// PG `pg_cancel_backend`, MySQL `KILL QUERY`, Mongo `killOp`: the session stays
    CancelQuery,
    /// PG `pg_terminate_backend`, MySQL `KILL`, Redis `CLIENT KILL ID`: the connection drops
    EndSession,
}

/// One server session (Mongo: one operation in progress), as the server reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// pid (PG), thread id (MySQL), opid (Mongo), client id (Redis)
    pub id: String,
    pub user: Option<String>,
    pub database: Option<String>,
    pub state: Option<String>,
    /// in the current state (PG, MySQL), running (Mongo) or idle (Redis)
    pub seconds: Option<u32>,
    /// address and application name
    pub client: Option<String>,
    /// the statement or last command
    pub query: Option<String>,
    /// the session that ran this listing: the app's own
    pub own: bool,
}

/// One entry of Redis' SLOWLOG.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SlowCommand {
    pub id: String,
    /// unix seconds
    pub started_at: u32,
    pub duration_us: u32,
    pub command: String,
    pub client: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionList {
    /// the query or command that produced the list, shown on the screen
    pub statement: String,
    pub sessions: Vec<SessionInfo>,
    /// what this engine can do to a session
    pub actions: Vec<KillAction>,
    /// Redis only: `SLOWLOG GET`
    pub slow_log: Vec<SlowCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum KillResponse {
    Done,
    NeedsConfirmation { confirmation: Confirmation },
}
