use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::cell::Cell;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RelationKind {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub name: String,
    pub kind: RelationKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub relations: Vec<Relation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_primary_key: bool,
    /// values the column accepts (enum labels, boolean literals); empty = free text
    pub options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub definition: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub definition: String,
    pub columns: Vec<String>,
    pub referenced_schema: String,
    pub referenced_table: String,
    /// empty when SQLite points at the referenced primary key implicitly
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

/// A table of the ER diagram: its columns and the foreign keys leaving it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagramTable {
    pub name: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

/// Tables and their columns, for editor autocomplete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompletionTable {
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    Like,
    /// value is a comma-separated list: `1, 2, 3`
    In,
    IsNull,
    IsNotNull,
}

impl FilterOp {
    /// IS NULL / IS NOT NULL compare with nothing; every other operator needs a value.
    pub fn needs_value(self) -> bool {
        !matches!(self, FilterOp::IsNull | FilterOp::IsNotNull)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    /// required unless the operator is IsNull/IsNotNull, where it is ignored
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseRequest {
    pub schema: String,
    pub table: String,
    pub filters: Vec<Filter>,
    pub sort: Option<Sort>,
    /// 0-based
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub type_name: String,
    /// scalar type the grid can write back as text (not arrays, bytea, unmodeled types)
    pub editable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RowBatch {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<Cell>>,
    pub has_more: bool,
}

/// Result of the last statement of a script.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StatementResult {
    /// `cursor_id` is set while more rows can be fetched with `fetch_more`
    #[serde(rename_all = "camelCase")]
    Rows {
        batch: RowBatch,
        cursor_id: Option<String>,
    },
    /// DDL/DML/utility statement. u32 because specta forbids u64; saturates at ~4 billion.
    #[serde(rename_all = "camelCase")]
    Command { rows_affected: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutcome {
    pub statement_count: u32,
    pub duration_ms: u32,
    pub result: StatementResult,
}

/// A write the user must confirm before it runs: destructive statements anywhere,
/// and every write on a `prod` connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Confirmation {
    pub reason: String,
    pub statements: Vec<String>,
    /// DROP, TRUNCATE, a DELETE without WHERE, `$out`, FLUSHDB…: on `prod` the UI
    /// asks for more than a click before these run
    pub destructive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RunResponse {
    Executed { outcome: ScriptOutcome },
    NeedsConfirmation { confirmation: Confirmation },
}

/// One step of a query plan, in the engine's own words and units. Costs are the
/// planner's estimate for the node including its children (SQLite has none).
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanNode {
    /// "Seq Scan on users", "users (ALL)", "SCAN users"
    pub label: String,
    /// conditions, keys and sort keys, as "Filter: (id > 1)"
    pub details: Vec<String>,
    pub cost: Option<f64>,
    pub rows: Option<f64>,
    /// EXPLAIN ANALYZE only: rows per loop, time per loop and loops
    pub actual_rows: Option<f64>,
    pub actual_ms: Option<f64>,
    pub loops: Option<f64>,
    pub children: Vec<PlanNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExplainPlan {
    /// the exact EXPLAIN that ran
    pub sql: String,
    pub root: PlanNode,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ExplainResponse {
    Explained { plan: ExplainPlan },
    NeedsConfirmation { confirmation: Confirmation },
}

/// Original value of a primary-key column, identifying the row to change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub column: String,
    pub value: Cell,
}

/// New value typed by the user; `None` writes NULL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnValue {
    pub column: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RowChange {
    Update {
        key: Vec<KeyValue>,
        values: Vec<ColumnValue>,
    },
    Insert {
        values: Vec<ColumnValue>,
    },
    Delete {
        key: Vec<KeyValue>,
    },
}

/// Staged grid edits, applied in one transaction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableChanges {
    pub schema: String,
    pub table: String,
    pub changes: Vec<RowChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ApplyResponse {
    #[serde(rename_all = "camelCase")]
    Applied {
        rows_changed: u32,
    },
    NeedsConfirmation {
        confirmation: Confirmation,
    },
}

/// A column of a new table or one being added. `data_type` and `default` are SQL as
/// the user types it (`varchar(20)`, `now()`, `'a'`): it goes into the DDL as is, and
/// the exact command is shown before it runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
}

/// One change of a table's structure; each becomes a single DDL statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SchemaChange {
    #[serde(rename_all = "camelCase")]
    CreateTable {
        columns: Vec<ColumnDefinition>,
        primary_key: Vec<String>,
    },
    AddColumn {
        column: ColumnDefinition,
    },
    #[serde(rename_all = "camelCase")]
    RenameColumn {
        column: String,
        new_name: String,
    },
    DropColumn {
        column: String,
    },
    /// Postgres; `using` converts values the server cannot cast by itself
    #[serde(rename_all = "camelCase")]
    SetType {
        column: String,
        data_type: String,
        using: Option<String>,
    },
    /// Postgres and MySQL; `None` drops the default
    SetDefault {
        column: String,
        default: Option<String>,
    },
    /// Postgres
    SetNullable {
        column: String,
        nullable: bool,
    },
    /// MySQL: `MODIFY COLUMN` rewrites the whole column, so its whole definition is given
    RedefineColumn {
        column: String,
        definition: String,
    },
    CreateIndex {
        name: String,
        columns: Vec<String>,
        unique: bool,
    },
    DropIndex {
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: u32,
    pub connection_id: String,
    pub connection_name: String,
    pub sql: String,
    /// ISO 8601, UTC
    pub executed_at: String,
    pub duration_ms: u32,
    pub success: bool,
    pub error: Option<String>,
    pub starred: bool,
}
