//! What differs between SQL dialects in the SQL we generate and parse: identifier
//! and string quoting, text casts, statement splitting and the parser grammar.

use std::ops::Range;

use sqlparser::dialect::{MySqlDialect, PostgreSqlDialect, SQLiteDialect};

use crate::adapters::split::{self, SplitRules};
use crate::domain::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Postgres,
    /// `backslash_escapes` is false when the server runs with NO_BACKSLASH_ESCAPES
    Mysql {
        backslash_escapes: bool,
    },
    Sqlite,
}

impl Dialect {
    pub fn quote_ident(self, name: &str) -> String {
        match self {
            Dialect::Mysql { .. } => format!("`{}`", name.replace('`', "``")),
            Dialect::Postgres | Dialect::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
        }
    }

    /// A string literal holding exactly `value`. Values travel inlined because the
    /// text protocols take no bind parameters.
    pub fn quote_literal(self, value: &str) -> Result<String, AppError> {
        if value.contains('\0') {
            return Err(AppError::validation("valor não pode conter byte nulo"));
        }
        let quoted = value.replace('\'', "''");
        Ok(match self {
            // libpq's PQescapeLiteral: E'' whenever there is a backslash, correct
            // whatever standard_conforming_strings is set to
            Dialect::Postgres if value.contains('\\') => {
                format!("E'{}'", quoted.replace('\\', "\\\\"))
            }
            Dialect::Mysql {
                backslash_escapes: true,
            } => format!("'{}'", quoted.replace('\\', "\\\\")),
            Dialect::Postgres | Dialect::Mysql { .. } | Dialect::Sqlite => format!("'{quoted}'"),
        })
    }

    /// Column as text, for LIKE filters on any type.
    pub fn text_cast(self, column: &str) -> String {
        match self {
            Dialect::Postgres => format!("{column}::text"),
            Dialect::Mysql { .. } => format!("CAST({column} AS CHAR)"),
            Dialect::Sqlite => format!("CAST({column} AS TEXT)"),
        }
    }

    pub fn split(self, sql: &str) -> Vec<String> {
        split::split_statements(sql, self.split_rules())
    }

    /// Where each statement of `split` sits in `sql`, as byte ranges.
    pub fn spans(self, sql: &str) -> Vec<Range<usize>> {
        split::statement_spans(sql, self.split_rules())
    }

    fn split_rules(self) -> SplitRules {
        match self {
            Dialect::Postgres => split::POSTGRES,
            Dialect::Mysql { backslash_escapes } => split::mysql(backslash_escapes),
            Dialect::Sqlite => split::SQLITE,
        }
    }

    pub fn parser(self) -> Box<dyn sqlparser::dialect::Dialect> {
        match self {
            Dialect::Postgres => Box::new(PostgreSqlDialect {}),
            Dialect::Mysql { .. } => Box::new(MySqlDialect {}),
            Dialect::Sqlite => Box::new(SQLiteDialect {}),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MYSQL: Dialect = Dialect::Mysql {
        backslash_escapes: true,
    };
    const MYSQL_NBE: Dialect = Dialect::Mysql {
        backslash_escapes: false,
    };

    #[test]
    fn quotes_identifiers() {
        assert_eq!(Dialect::Postgres.quote_ident(r#"we"ird"#), r#""we""ird""#);
        assert_eq!(Dialect::Sqlite.quote_ident("users"), r#""users""#);
        assert_eq!(MYSQL.quote_ident("we`ird"), "`we``ird`");
    }

    #[test]
    fn quotes_literals() {
        let cases = [
            (Dialect::Postgres, "it's", "'it''s'"),
            (Dialect::Postgres, r"a\b'c", r"E'a\\b''c'"),
            (MYSQL, r"a\b'c", r"'a\\b''c'"),
            (MYSQL_NBE, r"a\b'c", r"'a\b''c'"),
            (Dialect::Sqlite, r"a\b'c", r"'a\b''c'"),
            (MYSQL, "'; DROP TABLE x; --", "'''; DROP TABLE x; --'"),
        ];
        for (dialect, value, expected) in cases {
            assert_eq!(
                dialect.quote_literal(value).unwrap(),
                expected,
                "{dialect:?}"
            );
        }
        for dialect in [Dialect::Postgres, MYSQL, Dialect::Sqlite] {
            assert!(matches!(
                dialect.quote_literal("a\0b"),
                Err(AppError::Validation(_))
            ));
        }
    }

    #[test]
    fn text_casts() {
        assert_eq!(Dialect::Postgres.text_cast("\"c\""), "\"c\"::text");
        assert_eq!(MYSQL.text_cast("`c`"), "CAST(`c` AS CHAR)");
        assert_eq!(Dialect::Sqlite.text_cast("\"c\""), "CAST(\"c\" AS TEXT)");
    }
}
