//! Builds the table-browsing query. Values are inlined as escaped literals (libpq's
//! PQescapeLiteral algorithm) because every query runs on the text protocol, which
//! takes no bind parameters; identifiers are always quoted.

use crate::domain::{AppError, BrowseRequest, FilterOp, SortDirection};

pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Doubles quotes; with any backslash, doubles them and uses E'' so the result is
/// correct whatever `standard_conforming_strings` is set to.
pub fn quote_literal(value: &str) -> Result<String, AppError> {
    if value.contains('\0') {
        return Err(AppError::validation("valor não pode conter byte nulo"));
    }
    let escaped = value.replace('\'', "''");
    if value.contains('\\') {
        Ok(format!("E'{}'", escaped.replace('\\', "\\\\")))
    } else {
        Ok(format!("'{escaped}'"))
    }
}

/// Fetches `page_size + 1` rows so the caller knows whether a next page exists.
/// Without an explicit sort, orders by primary key so pages are stable.
pub fn browse_sql(request: &BrowseRequest, primary_key: &[String]) -> Result<String, AppError> {
    let mut sql = format!(
        "SELECT * FROM {}.{}",
        quote_ident(&request.schema),
        quote_ident(&request.table)
    );

    let mut conditions = Vec::new();
    for filter in &request.filters {
        let column = quote_ident(&filter.column);
        let value = filter.value.as_deref().unwrap_or_default();
        conditions.push(match filter.op {
            FilterOp::Eq => format!("{column} = {}", quote_literal(value)?),
            FilterOp::Like => format!("{column}::text LIKE {}", quote_literal(value)?),
            FilterOp::IsNull => format!("{column} IS NULL"),
            FilterOp::IsNotNull => format!("{column} IS NOT NULL"),
        });
    }
    if !conditions.is_empty() {
        sql.push_str(&format!(" WHERE {}", conditions.join(" AND ")));
    }

    let order: Vec<String> = match &request.sort {
        Some(sort) => {
            let direction = match sort.direction {
                SortDirection::Asc => "ASC",
                SortDirection::Desc => "DESC",
            };
            vec![format!("{} {direction}", quote_ident(&sort.column))]
        }
        None => primary_key.iter().map(|c| quote_ident(c)).collect(),
    };
    if !order.is_empty() {
        sql.push_str(&format!(" ORDER BY {}", order.join(", ")));
    }

    let offset = u64::from(request.page) * u64::from(request.page_size);
    sql.push_str(&format!(" LIMIT {} OFFSET {offset}", request.page_size + 1));
    Ok(sql)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Filter, Sort};

    fn request() -> BrowseRequest {
        BrowseRequest {
            schema: "public".into(),
            table: "users".into(),
            filters: vec![],
            sort: None,
            page: 0,
            page_size: 100,
        }
    }

    #[test]
    fn quotes_identifiers() {
        assert_eq!(quote_ident("users"), r#""users""#);
        assert_eq!(quote_ident(r#"we"ird"#), r#""we""ird""#);
    }

    #[test]
    fn quotes_literals() {
        assert_eq!(quote_literal("abc").unwrap(), "'abc'");
        assert_eq!(quote_literal("it's").unwrap(), "'it''s'");
        assert_eq!(quote_literal(r"a\b'c").unwrap(), r"E'a\\b''c'");
        assert_eq!(
            quote_literal("'; DROP TABLE x; --").unwrap(),
            "'''; DROP TABLE x; --'"
        );
        assert!(matches!(
            quote_literal("a\0b"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn plain_page_orders_by_primary_key() {
        let sql = browse_sql(&request(), &["id".into(), "tenant".into()]).unwrap();
        assert_eq!(
            sql,
            r#"SELECT * FROM "public"."users" ORDER BY "id", "tenant" LIMIT 101 OFFSET 0"#
        );
    }

    #[test]
    fn filters_sort_and_page() {
        let mut req = request();
        req.page = 3;
        req.page_size = 50;
        req.sort = Some(Sort {
            column: "name".into(),
            direction: SortDirection::Desc,
        });
        req.filters = vec![
            Filter {
                column: "email".into(),
                op: FilterOp::Like,
                value: Some("%@x.com".into()),
            },
            Filter {
                column: "age".into(),
                op: FilterOp::Eq,
                value: Some("30".into()),
            },
            Filter {
                column: "deleted_at".into(),
                op: FilterOp::IsNull,
                value: Some("ignored".into()),
            },
            Filter {
                column: "verified_at".into(),
                op: FilterOp::IsNotNull,
                value: None,
            },
        ];

        let sql = browse_sql(&req, &["id".into()]).unwrap();

        assert_eq!(
            sql,
            concat!(
                r#"SELECT * FROM "public"."users" WHERE "email"::text LIKE '%@x.com' AND "age" = '30' "#,
                r#"AND "deleted_at" IS NULL AND "verified_at" IS NOT NULL "#,
                r#"ORDER BY "name" DESC LIMIT 51 OFFSET 150"#
            )
        );
    }

    #[test]
    fn no_primary_key_and_no_sort_means_no_order_by() {
        let sql = browse_sql(&request(), &[]).unwrap();
        assert_eq!(sql, r#"SELECT * FROM "public"."users" LIMIT 101 OFFSET 0"#);
    }
}
