//! EXPLAIN in each dialect, and its output as a `PlanNode` tree: Postgres and
//! MySQL answer with JSON, SQLite with `EXPLAIN QUERY PLAN` rows (no costs).

use serde_json::{Map, Value};

use crate::adapters::dialect::Dialect;
use crate::domain::{AppError, Cell, PlanNode, RowBatch};

/// Only Postgres reports ANALYZE as JSON: MySQL's EXPLAIN ANALYZE is a text tree
/// (JSON only from 8.3 on), and SQLite has no ANALYZE for plans.
pub fn explain_sql(dialect: Dialect, statement: &str, analyze: bool) -> Result<String, AppError> {
    Ok(match (dialect, analyze) {
        (Dialect::Postgres, false) => format!("EXPLAIN (FORMAT JSON) {statement}"),
        (Dialect::Postgres, true) => format!("EXPLAIN (ANALYZE, FORMAT JSON) {statement}"),
        (Dialect::Mysql { .. }, false) => format!("EXPLAIN FORMAT=JSON {statement}"),
        (Dialect::Sqlite, false) => format!("EXPLAIN QUERY PLAN {statement}"),
        (_, true) => {
            return Err(AppError::validation(
                "EXPLAIN ANALYZE só está disponível no Postgres",
            ));
        }
    })
}

pub fn parse(dialect: Dialect, batch: &RowBatch) -> Result<PlanNode, AppError> {
    match dialect {
        Dialect::Postgres => postgres(&json(batch)?),
        Dialect::Mysql { .. } => mysql(&json(batch)?),
        Dialect::Sqlite => Ok(sqlite(batch)),
    }
}

fn json(batch: &RowBatch) -> Result<Value, AppError> {
    let text = match batch.rows.first().and_then(|row| row.first()) {
        Some(Cell::Json(text) | Cell::Text(text)) => text,
        _ => return Err(unexpected()),
    };
    serde_json::from_str(text).map_err(|_| unexpected())
}

fn unexpected() -> AppError {
    AppError::validation("o banco devolveu um plano em formato inesperado")
}

fn node(label: String) -> PlanNode {
    PlanNode {
        label,
        details: Vec::new(),
        cost: None,
        rows: None,
        actual_rows: None,
        actual_ms: None,
        loops: None,
        children: Vec::new(),
    }
}

/// Numbers that MySQL writes as strings ("1.25") too.
fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// "key: value", arrays joined; a true flag is just its name.
fn detail(key: &str, value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(format!("{key}: {s}")),
        Value::Number(n) => Some(format!("{key}: {n}")),
        Value::Bool(true) => Some(key.to_string()),
        Value::Array(items) => {
            let items: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
            (!items.is_empty()).then(|| format!("{key}: {}", items.join(", ")))
        }
        _ => None,
    }
}

const PG_DETAILS: &[&str] = &[
    "Index Cond",
    "Recheck Cond",
    "Hash Cond",
    "Merge Cond",
    "Join Filter",
    "Filter",
    "Rows Removed by Filter",
    "Sort Key",
    "Group Key",
    "Strategy",
];

/// `[{"Plan": {...}, "Planning Time": …, "Execution Time": …}]`
fn postgres(output: &Value) -> Result<PlanNode, AppError> {
    let top = output.get(0).ok_or_else(unexpected)?;
    let plan = top
        .get("Plan")
        .and_then(Value::as_object)
        .ok_or_else(unexpected)?;
    let mut root = postgres_node(plan);
    for key in ["Planning Time", "Execution Time"] {
        if let Some(ms) = number(top.get(key)) {
            root.details.push(format!("{key}: {ms} ms"));
        }
    }
    Ok(root)
}

/// Labels like the text format: "Index Scan using users_pkey on users u",
/// "Hash Left Join".
fn postgres_node(plan: &Map<String, Value>) -> PlanNode {
    let text = |key: &str| plan.get(key).and_then(Value::as_str);
    let mut label = text("Node Type").unwrap_or("?").to_string();
    if let Some(join) = text("Join Type").filter(|join| *join != "Inner") {
        label = match label.strip_suffix(" Join") {
            Some(kind) => format!("{kind} {join} Join"),
            None => format!("{label} {join} Join"),
        };
    }
    if plan.get("Parallel Aware") == Some(&Value::Bool(true)) {
        label = format!("Parallel {label}");
    }
    if let Some(index) = text("Index Name") {
        label.push_str(&format!(" using {index}"));
    }
    let target = text("Relation Name")
        .or_else(|| text("CTE Name"))
        .or_else(|| text("Function Name"));
    if let Some(target) = target {
        label.push_str(&format!(" on {target}"));
        if let Some(alias) = text("Alias").filter(|alias| *alias != target) {
            label.push_str(&format!(" {alias}"));
        }
    }

    let mut result = node(label);
    result.details = PG_DETAILS
        .iter()
        .filter_map(|key| detail(key, plan.get(*key)?))
        .collect();
    result.cost = number(plan.get("Total Cost"));
    result.rows = number(plan.get("Plan Rows"));
    result.actual_rows = number(plan.get("Actual Rows"));
    result.actual_ms = number(plan.get("Actual Total Time"));
    result.loops = number(plan.get("Actual Loops"));
    result.children = plan
        .get("Plans")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(postgres_node)
        .collect();
    result
}

const MYSQL_DETAILS: &[&str] = &[
    "message",
    "key",
    "ref",
    "attached_condition",
    "using_index",
    "using_filesort",
    "using_temporary_table",
];

/// MySQL's JSON (format version 1) nests operations by name: `query_block` →
/// `ordering_operation` → `nested_loop: [{table}, {table}]`. Every nested object
/// becomes a node named after its key, and so does an array of objects, whose
/// items are only wrappers.
fn mysql(output: &Value) -> Result<PlanNode, AppError> {
    let block = output
        .get("query_block")
        .and_then(Value::as_object)
        .ok_or_else(unexpected)?;
    Ok(mysql_node("query_block", block, mysql_children(block)))
}

fn mysql_node(key: &str, value: &Map<String, Value>, children: Vec<PlanNode>) -> PlanNode {
    let text = |key: &str| value.get(key).and_then(Value::as_str);
    let label = match (key, text("table_name")) {
        ("table", Some(table)) => format!("{table} ({})", text("access_type").unwrap_or("?")),
        _ => key.to_string(),
    };
    let mut result = node(label);
    result.details = MYSQL_DETAILS
        .iter()
        .filter_map(|key| detail(key, value.get(*key)?))
        .collect();
    result.rows = number(value.get("rows_examined_per_scan"));
    result.children = children;

    // ponytail: format version 1 only has per-table costs (read + eval, which add
    // up along a join) and the block total; other nodes sum their children
    let costs = value.get("cost_info");
    let field = |name: &str| number(costs.and_then(|c| c.get(name)));
    let own = match (field("read_cost"), field("eval_cost")) {
        (Some(read), Some(eval)) => Some(read + eval),
        _ => field("sort_cost"),
    };
    let below: Vec<f64> = result.children.iter().filter_map(|c| c.cost).collect();
    result.cost = field("query_cost").or_else(|| match (own, below.is_empty()) {
        (None, true) => None,
        (own, _) => Some(own.unwrap_or(0.0) + below.iter().sum::<f64>()),
    });
    result
}

fn mysql_children(value: &Map<String, Value>) -> Vec<PlanNode> {
    value
        .iter()
        .filter_map(|(key, child)| match child {
            Value::Object(object) if key != "cost_info" => {
                Some(mysql_node(key, object, mysql_children(object)))
            }
            Value::Array(items) => {
                let children: Vec<PlanNode> = items
                    .iter()
                    .filter_map(Value::as_object)
                    .flat_map(mysql_children)
                    .collect();
                (!children.is_empty()).then(|| mysql_node(key, &Map::new(), children))
            }
            _ => None,
        })
        .collect()
}

/// Rows of `id, parent, notused, detail`; a parent is always an earlier row (a
/// lower id). Under one "QUERY PLAN" root, as the sqlite3 shell prints it.
fn sqlite(batch: &RowBatch) -> PlanNode {
    let int = |cell: Option<&Cell>| match cell {
        Some(Cell::Int(n)) => n.parse::<i64>().ok(),
        _ => None,
    };
    let rows: Vec<(i64, i64, String)> = batch
        .rows
        .iter()
        .filter_map(|row| {
            let detail = match row.get(3) {
                Some(Cell::Text(text)) => text.clone(),
                _ => return None,
            };
            Some((int(row.first())?, int(row.get(1))?, detail))
        })
        .collect();

    fn children(rows: &[(i64, i64, String)], parent: i64) -> Vec<PlanNode> {
        rows.iter()
            .filter(|(id, of, _)| *of == parent && *id > parent)
            .map(|(id, _, detail)| PlanNode {
                children: children(rows, *id),
                ..node(detail.clone())
            })
            .collect()
    }
    PlanNode {
        children: children(&rows, 0),
        ..node("QUERY PLAN".to_string())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    /// Every label in the tree, depth first.
    pub(crate) fn labels(node: &PlanNode) -> Vec<String> {
        std::iter::once(node.label.clone())
            .chain(node.children.iter().flat_map(labels))
            .collect()
    }

    fn batch(rows: Vec<Vec<Cell>>) -> RowBatch {
        RowBatch {
            columns: Vec::new(),
            rows,
            has_more: false,
        }
    }

    #[test]
    fn builds_the_explain_of_each_dialect() {
        let mysql = Dialect::Mysql {
            backslash_escapes: true,
        };
        let cases = [
            (Dialect::Postgres, false, "EXPLAIN (FORMAT JSON) SELECT 1"),
            (
                Dialect::Postgres,
                true,
                "EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1",
            ),
            (mysql, false, "EXPLAIN FORMAT=JSON SELECT 1"),
            (Dialect::Sqlite, false, "EXPLAIN QUERY PLAN SELECT 1"),
        ];
        for (dialect, analyze, expected) in cases {
            assert_eq!(explain_sql(dialect, "SELECT 1", analyze).unwrap(), expected);
        }
        assert!(explain_sql(mysql, "SELECT 1", true).is_err());
        assert!(explain_sql(Dialect::Sqlite, "SELECT 1", true).is_err());
    }

    #[test]
    fn postgres_plans() {
        let output = json!([{
            "Plan": {
                "Node Type": "Hash Join", "Join Type": "Left",
                "Total Cost": 35.5, "Plan Rows": 100,
                "Actual Rows": 98, "Actual Total Time": 1.25, "Actual Loops": 1,
                "Hash Cond": "(o.user_id = u.id)",
                "Plans": [
                    {"Node Type": "Seq Scan", "Relation Name": "orders", "Alias": "o",
                     "Total Cost": 20.0, "Plan Rows": 100, "Filter": "(total > 0)"},
                    {"Node Type": "Index Scan", "Index Name": "users_pkey",
                     "Relation Name": "users", "Alias": "users", "Parallel Aware": true,
                     "Total Cost": 8.3, "Plan Rows": 1},
                    {"Node Type": "Nested Loop", "Join Type": "Anti", "Total Cost": 1.0,
                     "Plan Rows": 1, "Sort Key": ["a", "b DESC"]}
                ]
            },
            "Planning Time": 0.1,
            "Execution Time": 1.5
        }])
        .to_string();
        let root = parse(Dialect::Postgres, &batch(vec![vec![Cell::Json(output)]])).unwrap();

        assert_eq!(root.label, "Hash Left Join");
        assert_eq!(
            root.details,
            [
                "Hash Cond: (o.user_id = u.id)",
                "Planning Time: 0.1 ms",
                "Execution Time: 1.5 ms"
            ]
        );
        assert_eq!(
            (
                root.cost,
                root.rows,
                root.actual_rows,
                root.actual_ms,
                root.loops
            ),
            (Some(35.5), Some(100.0), Some(98.0), Some(1.25), Some(1.0))
        );
        let labels: Vec<&str> = root.children.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "Seq Scan on orders o",
                "Parallel Index Scan using users_pkey on users",
                "Nested Loop Anti Join"
            ]
        );
        assert_eq!(root.children[0].details, ["Filter: (total > 0)"]);
        assert_eq!(root.children[2].details, ["Sort Key: a, b DESC"]);
        assert_eq!(root.children[1].actual_rows, None);
    }

    #[test]
    fn mysql_plans() {
        let output = json!({
            "query_block": {
                "select_id": 1,
                "cost_info": {"query_cost": "5.75"},
                "ordering_operation": {
                    "using_filesort": true,
                    "cost_info": {"sort_cost": "2.00"},
                    "nested_loop": [
                        {"table": {"table_name": "o", "access_type": "ALL",
                                   "rows_examined_per_scan": 4,
                                   "cost_info": {"read_cost": "0.50", "eval_cost": "0.40",
                                                 "prefix_cost": "0.90"},
                                   "attached_condition": "(`o`.`total` > 0)"}},
                        {"table": {"table_name": "u", "access_type": "eq_ref",
                                   "key": "PRIMARY", "ref": ["test.o.user_id"],
                                   "rows_examined_per_scan": 1,
                                   "cost_info": {"read_cost": "1.00", "eval_cost": "0.10"}}}
                    ]
                }
            }
        })
        .to_string();
        let mysql = Dialect::Mysql {
            backslash_escapes: true,
        };
        let root = parse(mysql, &batch(vec![vec![Cell::Text(output)]])).unwrap();

        assert_eq!(root.label, "query_block");
        assert_eq!(root.cost, Some(5.75));
        let sort = &root.children[0];
        assert_eq!(sort.label, "ordering_operation");
        assert_eq!(sort.details, ["using_filesort"]);
        let nested = &sort.children[0];
        assert_eq!(nested.label, "nested_loop");
        let [o, u] = nested.children.as_slice() else {
            panic!("two tables expected: {nested:?}");
        };
        assert_eq!(o.label, "o (ALL)");
        assert_eq!(o.rows, Some(4.0));
        assert_eq!(o.details, ["attached_condition: (`o`.`total` > 0)"]);
        assert_eq!(u.label, "u (eq_ref)");
        assert_eq!(u.details, ["key: PRIMARY", "ref: test.o.user_id"]);
        // per-table costs add up the tree
        assert!((nested.cost.unwrap() - 2.0).abs() < 1e-9);
        assert!((sort.cost.unwrap() - 4.0).abs() < 1e-9);

        let no_tables = json!({"query_block": {"select_id": 1, "message": "No tables used"}});
        let root = parse(mysql, &batch(vec![vec![Cell::Json(no_tables.to_string())]])).unwrap();
        assert_eq!(root.details, ["message: No tables used"]);
        assert_eq!(root.cost, None);
    }

    #[test]
    fn sqlite_plans_nest_by_parent() {
        let row = |id: &str, parent: &str, detail: &str| {
            vec![
                Cell::Int(id.into()),
                Cell::Int(parent.into()),
                Cell::Int("0".into()),
                Cell::Text(detail.into()),
            ]
        };
        let root = parse(
            Dialect::Sqlite,
            &batch(vec![
                row("2", "0", "SCAN o"),
                row("5", "0", "CORRELATED SCALAR SUBQUERY 1"),
                row("8", "5", "SEARCH u USING INTEGER PRIMARY KEY (rowid=?)"),
            ]),
        )
        .unwrap();
        assert_eq!(root.label, "QUERY PLAN");
        assert_eq!(root.children.len(), 2);
        assert_eq!(root.children[0].label, "SCAN o");
        assert_eq!(
            root.children[1].children[0].label,
            "SEARCH u USING INTEGER PRIMARY KEY (rowid=?)"
        );
        assert_eq!(root.children[1].children[0].cost, None);
    }

    #[test]
    fn unexpected_output_is_an_error_not_a_panic() {
        for cells in [
            vec![],
            vec![Cell::Null],
            vec![Cell::Text("not json".into())],
        ] {
            assert!(parse(Dialect::Postgres, &batch(vec![cells])).is_err());
        }
        assert!(parse(Dialect::Postgres, &batch(vec![])).is_err());
        let mysql = Dialect::Mysql {
            backslash_escapes: false,
        };
        assert!(parse(mysql, &batch(vec![vec![Cell::Text("[]".into())]])).is_err());
    }
}
