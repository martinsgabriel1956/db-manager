//! Which statements need the user's confirmation before running:
//! - destructive ones on any connection (DROP, TRUNCATE, ALTER … DROP,
//!   UPDATE/DELETE without WHERE);
//! - every write on a `prod` connection.
//!
//! Uses a real SQL parser: regexes break on comments, strings and CTEs.

use sqlparser::ast::{AlterTableOperation, Query, SetExpr, Statement};
use sqlparser::parser::Parser;

use crate::adapters::dialect::Dialect;
use crate::domain::{Confirmation, Environment, StatementMark};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Risk {
    pub writes: bool,
    /// why it is destructive, if it is
    pub destructive: Option<String>,
}

impl Risk {
    fn read() -> Self {
        Risk::default()
    }

    fn write() -> Self {
        Risk {
            writes: true,
            destructive: None,
        }
    }

    fn destructive(reason: &str) -> Self {
        Risk {
            writes: true,
            destructive: Some(reason.to_string()),
        }
    }

    fn merge(self, other: Risk) -> Risk {
        Risk {
            writes: self.writes || other.writes,
            destructive: self.destructive.or(other.destructive),
        }
    }
}

pub fn classify(statement: &str, dialect: Dialect) -> Risk {
    match Parser::parse_sql(dialect.parser().as_ref(), statement) {
        Ok(parsed) => parsed
            .iter()
            .map(classify_statement)
            .fold(Risk::read(), Risk::merge),
        Err(_) => classify_unparsed(statement),
    }
}

/// `None` when the script can run as is.
pub fn confirmation_for(
    statements: &[String],
    dialect: Dialect,
    environment: Environment,
    read_only: bool,
) -> Option<Confirmation> {
    // the database rejects writes on read-only sessions; nothing to confirm
    if read_only {
        return None;
    }
    let risks: Vec<(&String, Risk)> = statements
        .iter()
        .map(|s| (s, classify(s, dialect)))
        .collect();

    // in a script, each reason says which statement it is, numbered as the results list
    // numbers them: among several writes the destructive one is named, not hunted for
    let total = risks.len();
    let reasons: Vec<String> = risks
        .iter()
        .enumerate()
        .filter_map(|(index, (_, risk))| {
            risk.destructive.as_deref().map(|reason| {
                if total > 1 {
                    format!("{reason} (comando {} de {total})", index + 1)
                } else {
                    reason.to_string()
                }
            })
        })
        .collect();
    // the listed statements with their place in the script (only for a script: a single
    // statement needs no number)
    let listed = |keep: &dyn Fn(&Risk) -> bool| -> (Vec<String>, Vec<StatementMark>) {
        risks
            .iter()
            .enumerate()
            .filter(|(_, (_, risk))| keep(risk))
            .map(|(index, (statement, risk))| {
                (
                    (*statement).clone(),
                    StatementMark {
                        number: index as u32 + 1,
                        of: total as u32,
                        destructive: risk.destructive.is_some(),
                    },
                )
            })
            .unzip()
    };
    let numbered = |marks: Vec<StatementMark>| if total > 1 { marks } else { Vec::new() };
    let prod = environment == Environment::Prod;
    if !reasons.is_empty() {
        // on prod every write is confirmed: the sheet shows them all, in script order, not
        // only the destructive ones (the others would run unseen under the same click)
        let (statements, marks) =
            listed(&|risk| risk.destructive.is_some() || (prod && risk.writes));
        return Some(Confirmation {
            marks: numbered(marks),
            reason: format!("Comando destrutivo: {}", reasons.join(", ")),
            statements,
            destructive: true,
        });
    }

    let (writes, marks) = listed(&|risk| risk.writes);
    (prod && !writes.is_empty()).then(|| Confirmation {
        marks: numbered(marks),
        reason: "Conexão de produção: confirme antes de escrever".to_string(),
        statements: writes,
        destructive: false,
    })
}

fn classify_statement(statement: &Statement) -> Risk {
    match statement {
        Statement::Query(query) => classify_query(query),
        Statement::Explain {
            analyze,
            options,
            statement,
            ..
        } => {
            let analyze_option = options.as_ref().is_some_and(|options| {
                options
                    .iter()
                    .any(|o| o.name.value.eq_ignore_ascii_case("analyze"))
            });
            // EXPLAIN ANALYZE executes the statement
            if *analyze || analyze_option {
                classify_statement(statement)
            } else {
                Risk::read()
            }
        }
        Statement::Set(_)
        | Statement::ShowVariable { .. }
        | Statement::StartTransaction { .. }
        | Statement::Commit { .. }
        | Statement::Rollback { .. }
        | Statement::Declare { .. }
        | Statement::Fetch { .. }
        | Statement::Close { .. }
        | Statement::Discard { .. } => Risk::read(),
        Statement::Drop { .. } => Risk::destructive("DROP"),
        Statement::Truncate(_) => Risk::destructive("TRUNCATE"),
        Statement::Delete(delete) if delete.selection.is_none() => {
            Risk::destructive("DELETE sem WHERE")
        }
        Statement::Update(update) if update.selection.is_none() => {
            Risk::destructive("UPDATE sem WHERE")
        }
        Statement::AlterTable(alter)
            if alter.operations.iter().any(|op| {
                matches!(
                    op,
                    AlterTableOperation::DropColumn { .. }
                        | AlterTableOperation::DropConstraint { .. }
                )
            }) =>
        {
            Risk::destructive("ALTER TABLE … DROP")
        }
        _ => Risk::write(),
    }
}

fn classify_query(query: &Query) -> Risk {
    let ctes = query
        .with
        .iter()
        .flat_map(|with| &with.cte_tables)
        .map(|cte| classify_query(&cte.query))
        .fold(Risk::read(), Risk::merge);
    ctes.merge(classify_set_expr(&query.body))
}

fn classify_set_expr(body: &SetExpr) -> Risk {
    match body {
        SetExpr::Select(select) if select.into.is_some() => Risk::write(),
        SetExpr::Select(_) | SetExpr::Values(_) | SetExpr::Table(_) => Risk::read(),
        SetExpr::Query(query) => classify_query(query),
        SetExpr::SetOperation { left, right, .. } => {
            classify_set_expr(left).merge(classify_set_expr(right))
        }
        // data-modifying CTE bodies (WITH d AS (DELETE …))
        SetExpr::Insert(statement)
        | SetExpr::Update(statement)
        | SetExpr::Delete(statement)
        | SetExpr::Merge(statement) => classify_statement(statement),
    }
}

/// The parser does not know every PostgreSQL construct. Without an AST, fall back
/// to the leading keyword and stay on the safe side for anything that can delete.
fn classify_unparsed(statement: &str) -> Risk {
    let keyword = leading_keyword(statement).to_ascii_uppercase();
    match keyword.as_str() {
        "SELECT" | "SHOW" | "VALUES" | "TABLE" | "SET" | "BEGIN" | "START" | "COMMIT"
        | "ROLLBACK" | "END" => Risk::read(),
        "DROP" | "TRUNCATE" => Risk::destructive(&keyword),
        "DELETE" | "UPDATE" | "ALTER" => {
            Risk::destructive(&format!("{keyword} (não foi possível analisar o comando)"))
        }
        _ => Risk::write(),
    }
}

fn leading_keyword(statement: &str) -> &str {
    let mut rest = statement.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("--") {
            rest = after
                .split_once('\n')
                .map_or("", |(_, tail)| tail)
                .trim_start();
        } else if let Some(after) = rest.strip_prefix("/*") {
            rest = after
                .split_once("*/")
                .map_or("", |(_, tail)| tail)
                .trim_start();
        } else {
            break;
        }
    }
    rest.split(|c: char| !c.is_ascii_alphabetic())
        .next()
        .unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_statements() {
        let read = Risk::read();
        let write = Risk::write();
        let destructive = |reason: &str| Risk::destructive(reason);
        let cases = [
            ("SELECT * FROM users", read),
            ("WITH t AS (SELECT 1) SELECT * FROM t", Risk::read()),
            ("SELECT 1 UNION SELECT 2", Risk::read()),
            ("VALUES (1)", Risk::read()),
            ("SET search_path TO app", Risk::read()),
            ("SHOW search_path", Risk::read()),
            ("BEGIN", Risk::read()),
            ("COMMIT", Risk::read()),
            ("EXPLAIN DELETE FROM users", Risk::read()),
            ("SELECT * INTO copy FROM users", write),
            ("INSERT INTO users (name) VALUES ('a')", Risk::write()),
            ("UPDATE users SET name = 'a' WHERE id = 1", Risk::write()),
            ("DELETE FROM users WHERE id = 1", Risk::write()),
            ("CREATE TABLE t (id int)", Risk::write()),
            ("ALTER TABLE t ADD COLUMN c int", Risk::write()),
            ("DROP TABLE users", destructive("DROP")),
            ("DROP INDEX IF EXISTS users_idx", destructive("DROP")),
            ("TRUNCATE users", destructive("TRUNCATE")),
            ("DELETE FROM users", destructive("DELETE sem WHERE")),
            (
                "UPDATE users SET active = false",
                destructive("UPDATE sem WHERE"),
            ),
            (
                "ALTER TABLE users DROP COLUMN email",
                destructive("ALTER TABLE … DROP"),
            ),
            (
                "ALTER TABLE users DROP CONSTRAINT users_email_key",
                destructive("ALTER TABLE … DROP"),
            ),
            (
                "EXPLAIN ANALYZE DELETE FROM users",
                destructive("DELETE sem WHERE"),
            ),
            (
                "EXPLAIN (ANALYZE) UPDATE users SET a = 1",
                destructive("UPDATE sem WHERE"),
            ),
            (
                "WITH gone AS (DELETE FROM users RETURNING *) SELECT count(*) FROM gone",
                destructive("DELETE sem WHERE"),
            ),
            (
                "WITH upd AS (UPDATE users SET a = 1 WHERE id = 2 RETURNING *) SELECT * FROM upd",
                Risk::write(),
            ),
            // comments and strings do not fool the parser
            (
                "SELECT 'DROP TABLE users' -- DELETE FROM users",
                Risk::read(),
            ),
            ("/* TRUNCATE */ SELECT 1", Risk::read()),
        ];
        for (sql, expected) in cases {
            assert_eq!(classify(sql, Dialect::Postgres), expected, "{sql}");
        }
        // the structure changes of the table view
        let structure = [
            (r#"ALTER TABLE "app"."t" RENAME TO "u""#, Risk::write()),
            (r#"ALTER INDEX "app"."i" RENAME TO "j""#, Risk::write()),
            (r#"DROP TABLE "app"."t""#, Risk::destructive("DROP")),
            (
                r#"ALTER TABLE "app"."t" ADD CONSTRAINT "c" CHECK (price >= 0)"#,
                Risk::write(),
            ),
            (
                r#"ALTER TABLE "app"."t" DROP CONSTRAINT "c""#,
                Risk::destructive("ALTER TABLE … DROP"),
            ),
        ];
        for (sql, expected) in structure {
            assert_eq!(classify(sql, Dialect::Postgres), expected, "{sql}");
        }
    }

    #[test]
    fn mysql_and_sqlite_grammars() {
        let mysql = Dialect::Mysql {
            backslash_escapes: true,
        };
        let cases = [
            (
                mysql,
                "DELETE FROM `orders`",
                Risk::destructive("DELETE sem WHERE"),
            ),
            (
                mysql,
                "UPDATE `t` SET `a` = 1 WHERE `id` = 2",
                Risk::write(),
            ),
            (mysql, "TRUNCATE TABLE logs", Risk::destructive("TRUNCATE")),
            (mysql, "SELECT * FROM `t` WHERE a = 'x\\'", Risk::read()),
            // the structure changes the table view generates
            (
                mysql,
                "DROP INDEX `t_ab` ON `app`.`t`",
                Risk::destructive("DROP"),
            ),
            (
                mysql,
                "ALTER TABLE `app`.`t` DROP COLUMN `c`",
                Risk::destructive("ALTER TABLE … DROP"),
            ),
            (
                mysql,
                "ALTER TABLE `app`.`t` MODIFY COLUMN `c` varchar(20) NOT NULL",
                Risk::write(),
            ),
            (
                Dialect::Sqlite,
                r#"DROP INDEX "main"."t_ab""#,
                Risk::destructive("DROP"),
            ),
            // the parser does not know RENAME INDEX: the safe fallback asks as destructive
            (
                mysql,
                "ALTER TABLE `app`.`t` RENAME INDEX `a` TO `b`",
                Risk::destructive("ALTER (não foi possível analisar o comando)"),
            ),
            (
                mysql,
                "ALTER TABLE `app`.`t` RENAME TO `app`.`u`",
                Risk::write(),
            ),
            (
                mysql,
                "ALTER TABLE `app`.`t` ADD CONSTRAINT `t_fk` FOREIGN KEY (`a`) REFERENCES `app`.`u` (`id`) ON DELETE CASCADE",
                Risk::write(),
            ),
            (
                mysql,
                "ALTER TABLE `app`.`t` DROP CONSTRAINT `t_fk`",
                Risk::destructive("ALTER TABLE … DROP"),
            ),
            (
                Dialect::Sqlite,
                r#"ALTER TABLE "main"."t" DROP COLUMN "c""#,
                Risk::destructive("ALTER TABLE … DROP"),
            ),
            (
                Dialect::Sqlite,
                "DROP TABLE IF EXISTS t",
                Risk::destructive("DROP"),
            ),
            (Dialect::Sqlite, "INSERT INTO t VALUES (1)", Risk::write()),
            (Dialect::Sqlite, "SELECT [weird name] FROM t", Risk::read()),
        ];
        for (dialect, sql, expected) in cases {
            assert_eq!(classify(sql, dialect), expected, "{sql}");
        }
    }

    #[test]
    fn unparsable_statements_fall_back_to_the_leading_keyword() {
        assert_eq!(
            classify_unparsed("-- note\n/* x */ DROP OWNED BY someone"),
            Risk::destructive("DROP")
        );
        assert_eq!(
            classify_unparsed("DELETE FROM t USING weird syntax"),
            Risk::destructive("DELETE (não foi possível analisar o comando)")
        );
        assert_eq!(classify_unparsed("SELECT weird syntax"), Risk::read());
        assert_eq!(classify_unparsed("REINDEX something"), Risk::write());
        assert_eq!(classify_unparsed("-- only comment"), Risk::write());
    }

    #[test]
    fn confirmation_policy() {
        let script = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let reads = script(&["SELECT 1", "SHOW search_path"]);
        let writes = script(&["SELECT 1", "UPDATE t SET a = 1 WHERE id = 1"]);
        let destructive = script(&["SELECT 1", "DELETE FROM t", "DROP TABLE x"]);

        assert_eq!(
            confirmation_for(&reads, Dialect::Postgres, Environment::Prod, false),
            None
        );
        assert_eq!(
            confirmation_for(&writes, Dialect::Postgres, Environment::Dev, false),
            None
        );
        assert_eq!(
            confirmation_for(&writes, Dialect::Postgres, Environment::Prod, false),
            Some(Confirmation {
                marks: vec![StatementMark {
                    number: 2,
                    of: 2,
                    destructive: false
                }],
                reason: "Conexão de produção: confirme antes de escrever".into(),
                statements: script(&["UPDATE t SET a = 1 WHERE id = 1"]),
                destructive: false,
            })
        );
        assert_eq!(
            confirmation_for(&destructive, Dialect::Postgres, Environment::Local, false),
            Some(Confirmation {
                marks: vec![
                    StatementMark {
                        number: 2,
                        of: 3,
                        destructive: true
                    },
                    StatementMark {
                        number: 3,
                        of: 3,
                        destructive: true
                    }
                ],
                reason:
                    "Comando destrutivo: DELETE sem WHERE (comando 2 de 3), DROP (comando 3 de 3)"
                        .into(),
                statements: script(&["DELETE FROM t", "DROP TABLE x"]),
                destructive: true,
            })
        );
        // a destructive script on prod lists every write it makes, not only the destructive one
        let mixed = script(&[
            "UPDATE t SET a = 1 WHERE id = 1",
            "SELECT 1",
            "DELETE FROM t",
        ]);
        assert_eq!(
            confirmation_for(&mixed, Dialect::Postgres, Environment::Prod, false),
            Some(Confirmation {
                marks: vec![
                    StatementMark {
                        number: 1,
                        of: 3,
                        destructive: false
                    },
                    StatementMark {
                        number: 3,
                        of: 3,
                        destructive: true
                    }
                ],
                reason: "Comando destrutivo: DELETE sem WHERE (comando 3 de 3)".into(),
                statements: script(&["UPDATE t SET a = 1 WHERE id = 1", "DELETE FROM t"]),
                destructive: true,
            })
        );
        // read-only sessions reject writes in the database itself
        assert_eq!(
            confirmation_for(&destructive, Dialect::Postgres, Environment::Prod, true),
            None
        );
    }
}
