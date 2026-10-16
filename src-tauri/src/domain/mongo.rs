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

/// How a field is indexed: ascending/descending, or a special index type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum IndexKind {
    #[serde(rename = "asc")]
    Asc,
    #[serde(rename = "desc")]
    Desc,
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "hashed")]
    Hashed,
    #[serde(rename = "2dsphere")]
    Sphere2d,
    #[serde(rename = "2d")]
    Flat2d,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexKey {
    pub field: String,
    pub kind: IndexKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewIndex {
    pub database: String,
    pub collection: String,
    /// in order: the order of a compound index matters
    pub keys: Vec<IndexKey>,
    /// empty: generated from the keys, as the drivers do (`email_1`)
    pub name: String,
    pub unique: bool,
    pub sparse: bool,
    /// TTL
    pub expire_after_seconds: Option<u32>,
    /// Extended JSON; empty means none
    pub partial_filter: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum IndexResponse {
    Applied,
    NeedsConfirmation { confirmation: Confirmation },
}
