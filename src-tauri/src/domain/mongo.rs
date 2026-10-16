use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::Confirmation;

/// Documents and _ids cross the boundary as Extended JSON text (see adapters/mongo/ejson.rs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub database: String,
    pub collection: String,
    /// Extended JSON; empty means everything
    pub filter: String,
    pub sort: String,
    pub projection: String,
    /// 0-based
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub documents: Vec<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AggregateOutcome {
    pub documents: Vec<String>,
    /// more results existed than the display limit
    pub truncated: bool,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AggregateResponse {
    Executed { outcome: AggregateOutcome },
    NeedsConfirmation { confirmation: Confirmation },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentWrite {
    Insert {
        document: String,
    },
    /// replaces the whole document with that _id
    Replace {
        id: String,
        document: String,
    },
    Delete {
        id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub database: String,
    pub collection: String,
    pub write: DocumentWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WriteResponse {
    /// `id` is the written document's _id, as Extended JSON
    Written {
        id: String,
    },
    NeedsConfirmation {
        confirmation: Confirmation,
    },
}

/// One change stream event, values as Extended JSON text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    /// insert, update, replace, delete, drop, invalidate…
    pub operation: String,
    /// documentKey._id
    pub id: Option<String>,
    /// fullDocument (insert, replace)
    pub document: Option<String>,
    /// updateDescription (update): updatedFields, removedFields, truncatedArrays
    pub diff: Option<String>,
    /// wallTime, or clusterTime (seconds) on servers before 6.0; RFC 3339
    pub at: Option<String>,
}

/// What a watch sends to the UI: events, then at most one error that ends it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WatchMessage {
    Change { event: ChangeEvent },
    Error { message: String },
}
