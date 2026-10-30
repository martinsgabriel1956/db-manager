use serde::{Deserialize, Serialize};
use specta::Type;

use crate::domain::cell::Cell;
use crate::domain::error::AppError;

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
    /// UNIQUE and CHECK constraints (Postgres), CHECKs (MySQL, where UNIQUE is an index);
    /// none on SQLite, which keeps them only in the CREATE TABLE text
    pub constraints: Vec<ConstraintInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInfo {
    pub name: String,
    pub definition: String,
}

/// The statements that create a table (or view), as the database reports them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableDdl {
    pub sql: String,
    /// true when rebuilt from the catalog (Postgres keeps no CREATE TABLE text)
    pub reconstructed: bool,
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

/// Result of one statement of a script.
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

/// How far a statement of a script got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Done,
    Failed,
    Cancelled,
    /// after the statement the script stopped at
    NotRun,
}

/// One statement of a script, in script order.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStep {
    pub status: StepStatus,
    pub duration_ms: u32,
    /// [from, to) in UTF-16 code units of the executed text: the UI slices it for labels
    /// and finds it in the editor, so the statements never travel back
    pub span: (u32, u32),
    /// rows returned (query) or affected (write); None while the last one still streams
    pub row_count: Option<u32>,
    /// the grid: None past the tab limit and for what did not run. An earlier result
    /// that kept only its first batch has `has_more` and no cursor.
    pub result: Option<StatementResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutcome {
    pub statement_count: u32,
    pub duration_ms: u32,
    /// one per statement
    pub steps: Vec<ScriptStep>,
    /// why the script stopped early; its step is the Failed or Cancelled one
    pub error: Option<AppError>,
}

impl ScriptOutcome {
    /// One statement that ran as a command (schema changes).
    pub fn command(duration_ms: u32, sql: &str) -> Self {
        let len = u32::try_from(sql.encode_utf16().count()).unwrap_or(u32::MAX);
        ScriptOutcome {
            statement_count: 1,
            duration_ms,
            steps: vec![ScriptStep {
                status: StepStatus::Done,
                duration_ms,
                span: (0, len),
                row_count: Some(0),
                result: Some(StatementResult::Command { rows_affected: 0 }),
            }],
            error: None,
        }
    }

    /// The last statement's result, for tests that ran a script to its end.
    #[cfg(test)]
    pub fn into_last(self) -> Option<StatementResult> {
        self.steps.into_iter().last().and_then(|step| step.result)
    }
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
    /// in a script, one per statement listed: where it sits and whether it is the destructive
    /// one, so the sheet numbers them as the results list does. Empty outside scripts
    pub marks: Vec<StatementMark>,
}

/// A statement's place in its script, 1-based like the results list ("3 de 4").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatementMark {
    pub number: u32,
    pub of: u32,
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

/// The value typed for a `:name` placeholder of the SQL editor. Text becomes a string
/// literal of the dialect; a number goes in bare after a check, so `LIMIT :n` works.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ParamValue {
    Null,
    Text(String),
    Number(String),
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
    /// Postgres and MySQL; SQLite cannot rename an index
    #[serde(rename_all = "camelCase")]
    RenameIndex {
        name: String,
        new_name: String,
    },
    /// stays in the same schema
    #[serde(rename_all = "camelCase")]
    RenameTable {
        new_name: String,
    },
    DropTable,
    /// Postgres and MySQL; SQLite only declares constraints in CREATE TABLE
    AddConstraint {
        name: String,
        constraint: Constraint,
    },
    DropConstraint {
        name: String,
    },
}

/// A constraint added to an existing table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Constraint {
    Unique {
        columns: Vec<String>,
    },
    /// the boolean SQL expression, as typed
    Check {
        expression: String,
    },
    /// to a table of the same schema
    #[serde(rename_all = "camelCase")]
    ForeignKey {
        columns: Vec<String>,
        referenced_table: String,
        referenced_columns: Vec<String>,
        on_delete: Option<ReferentialAction>,
    },
}

/// What a foreign key does when the referenced row is deleted: a closed list, not SQL text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ReferentialAction {
    Restrict,
    Cascade,
    SetNull,
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

/// What a schema comparison found different in a table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiffKind {
    Column,
    PrimaryKey,
    Index,
    Constraint,
    ForeignKey,
}

/// One difference; `None` on the side that does not have it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffItem {
    pub kind: DiffKind,
    pub name: String,
    pub source: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableDiff {
    pub table: String,
    pub items: Vec<DiffItem>,
}

/// The source schema compared with the target one, table by table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiff {
    pub only_in_source: Vec<String>,
    pub only_in_target: Vec<String>,
    /// tables on both sides that differ
    pub changed: Vec<TableDiff>,
    /// tables on both sides with nothing different
    pub equal: u32,
    /// what would bring the target to the source, shown and never run by the app;
    /// None where there is no generator yet (MySQL, SQLite)
    pub ddl: Option<String>,
}
