use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::Confirmation;

/// A logical database (SELECT index) and how many keys it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RedisDatabase {
    pub index: u8,
    pub keys: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyEntry {
    pub name: String,
    /// TYPE reply: string, hash, list, set, zset, stream, or a module type
    pub kind: String,
}

/// One SCAN step. `cursor` is "0" when the scan is complete; otherwise it goes back
/// into the next request. Strings because SCAN cursors are unsigned 64-bit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyPage {
    pub keys: Vec<KeyEntry>,
    pub cursor: String,
}

/// A Redis value as text. Values that are not UTF-8 come as a redis-cli style
/// escaped preview (`\xff`) with `binary: true`, and cannot be edited.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RedisText {
    pub text: String,
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HashEntry {
    pub field: RedisText,
    pub value: RedisText,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ZsetEntry {
    pub member: RedisText,
    /// as Redis prints it ("1.5", "inf"); floats never cross IPC
    pub score: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    pub id: String,
    pub fields: Vec<HashEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RedisValue {
    String {
        value: RedisText,
    },
    Hash {
        entries: Vec<HashEntry>,
    },
    List {
        items: Vec<RedisText>,
    },
    Set {
        members: Vec<RedisText>,
    },
    Zset {
        entries: Vec<ZsetEntry>,
    },
    Stream {
        entries: Vec<StreamEntry>,
    },
    /// RedisJSON (ReJSON-RL): the document as JSON.GET returns it, never parsed,
    /// so big numbers keep every digit
    Json {
        json: String,
    },
    /// other module types: shown by name only
    #[serde(rename_all = "camelCase")]
    Unsupported {
        type_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyDetail {
    pub key: String,
    /// seconds; None = no expiry
    pub ttl_secs: Option<u32>,
    /// elements (collections) or bytes (strings)
    pub length: u32,
    pub value: RedisValue,
    /// only the first elements (or bytes) were loaded
    pub truncated: bool,
}

/// One change to a key. A request carries several only to rename an entry
/// (remove + add), and they run in one MULTI/EXEC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum KeyEdit {
    SetString {
        value: String,
    },
    HashSet {
        field: String,
        value: String,
    },
    HashDelete {
        field: String,
    },
    ListSet {
        index: u32,
        value: String,
    },
    ListPush {
        value: String,
    },
    /// first element equal to `value` (LREM count 1)
    ListRemove {
        value: String,
    },
    SetAdd {
        member: String,
    },
    SetRemove {
        member: String,
    },
    ZsetAdd {
        member: String,
        score: String,
    },
    ZsetRemove {
        member: String,
    },
    /// None removes the expiry
    #[serde(rename_all = "camelCase")]
    Expire {
        ttl_secs: Option<u32>,
    },
    /// RedisJSON: replaces the whole document (JSON.SET key $ json)
    JsonSet {
        json: String,
    },
    #[serde(rename_all = "camelCase")]
    Rename {
        new_key: String,
    },
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyEditRequest {
    pub db: u8,
    pub key: String,
    pub edits: Vec<KeyEdit>,
    /// creating a new key: refused when the key already exists
    pub create: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum KeyEditResponse {
    Applied,
    NeedsConfirmation { confirmation: Confirmation },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    /// the reply formatted like redis-cli
    pub output: String,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CommandResponse {
    Executed { outcome: CommandOutcome },
    NeedsConfirmation { confirmation: Confirmation },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InfoSection {
    pub name: String,
    /// (field, value) in server order
    pub entries: Vec<(String, String)>,
}

/// A loaded module (MODULE LIST).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RedisModule {
    pub name: String,
    /// as the module reports it (RedisJSON 2.6.9 is 20609)
    pub version: String,
}
