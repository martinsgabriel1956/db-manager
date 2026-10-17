//! A schema of one SQL connection compared with a schema of another (dev against prod,
//! same engine), from the same catalog reads as the Structure tab. The DDL that would
//! bring the target to the source is only suggested: this screen never runs it.

use std::collections::{BTreeMap, BTreeSet};

use crate::adapters::SqlConnection;
use crate::adapters::dialect::Dialect;
use crate::adapters::sql_builder;
use crate::domain::{
    AppError, ColumnDefinition, ColumnInfo, DiffItem, DiffKind, SchemaChange, SchemaDiff,
    TableDiff, TableStructure,
};
use crate::registry::Registry;
use crate::use_cases::sql::schema_tables;

type Tables = [(String, TableStructure)];

pub async fn compare(
    registry: &Registry,
    source_id: &str,
    source_schema: &str,
    target_id: &str,
    target_schema: &str,
) -> Result<SchemaDiff, AppError> {
    let source_connection = registry.connection(source_id)?;
    let target_connection = registry.connection(target_id)?;
    let (source, target) = (source_connection.sql()?, target_connection.sql()?);
    if std::mem::discriminant(source) != std::mem::discriminant(target) {
        return Err(AppError::validation(
            "compare conexões da mesma engine: os tipos e o DDL de uma não valem na outra",
        ));
    }
    let (source_tables, target_tables) = tokio::try_join!(
        schema_tables(source, source_schema),
        schema_tables(target, target_schema)
    )?;
    let mut diff = compare_tables(&source_tables, &target_tables, source_schema, target_schema);
    // ponytail: DDL only for Postgres; MySQL and SQLite get the list of differences
    if let SqlConnection::Postgres(_) = source {
        // a new table comes whole from the source's own (reconstructed) CREATE TABLE
        let mut created = Vec::new();
        for table in &diff.only_in_source {
            created.push(source.ddl(source_schema, table).await?.sql);
        }
        diff.ddl = Some(postgres_ddl(
            &diff,
            &source_tables,
            &target_tables,
            &created,
            source_schema,
            target_schema,
        )?);
    }
    Ok(diff)
}

/// The two sides, table by table; `ddl` is left for the engine to fill.
pub fn compare_tables(
    source: &Tables,
    target: &Tables,
    source_schema: &str,
    target_schema: &str,
) -> SchemaDiff {
    let target_by_name: BTreeMap<&str, &TableStructure> = target
        .iter()
        .map(|(name, structure)| (name.as_str(), structure))
        .collect();
    let source_names: BTreeSet<&str> = source.iter().map(|(name, _)| name.as_str()).collect();
    let mut diff = SchemaDiff {
        only_in_source: Vec::new(),
        only_in_target: target
            .iter()
            .filter(|(name, _)| !source_names.contains(name.as_str()))
            .map(|(name, _)| name.clone())
            .collect(),
        changed: Vec::new(),
        equal: 0,
        ddl: None,
    };
    for (name, structure) in source {
        let Some(other) = target_by_name.get(name.as_str()) else {
            diff.only_in_source.push(name.clone());
            continue;
        };
        let items = table_items(structure, other, source_schema, target_schema);
        if items.is_empty() {
            diff.equal += 1;
        } else {
            diff.changed.push(TableDiff {
                table: name.clone(),
                items,
            });
        }
    }
    diff
}

fn table_items(
    source: &TableStructure,
    target: &TableStructure,
    source_schema: &str,
    target_schema: &str,
) -> Vec<DiffItem> {
    let mut items: Vec<DiffItem> = Vec::new();
    for column in &source.columns {
        let other = target.columns.iter().find(|c| c.name == column.name);
        if other.is_none_or(|other| column_text(other) != column_text(column)) {
            items.push(DiffItem {
                kind: DiffKind::Column,
                name: column.name.clone(),
                source: Some(column_text(column)),
                target: other.map(column_text),
            });
        }
    }
    for column in &target.columns {
        if !source.columns.iter().any(|c| c.name == column.name) {
            items.push(DiffItem {
                kind: DiffKind::Column,
                name: column.name.clone(),
                source: None,
                target: Some(column_text(column)),
            });
        }
    }
    let (source_key, target_key) = (primary_key(source), primary_key(target));
    if source_key != target_key {
        items.push(DiffItem {
            kind: DiffKind::PrimaryKey,
            name: "chave primária".to_string(),
            source: source_key,
            target: target_key,
        });
    }
    let named = |kind, source: Vec<(&str, &str)>, target: Vec<(&str, &str)>| {
        named_items(kind, &source, &target, source_schema, target_schema)
    };
    items.extend(named(
        DiffKind::Index,
        source
            .indexes
            .iter()
            .map(|i| (i.name.as_str(), i.definition.as_str()))
            .collect(),
        target
            .indexes
            .iter()
            .map(|i| (i.name.as_str(), i.definition.as_str()))
            .collect(),
    ));
    items.extend(named(
        DiffKind::Constraint,
        source
            .constraints
            .iter()
            .map(|c| (c.name.as_str(), c.definition.as_str()))
            .collect(),
        target
            .constraints
            .iter()
            .map(|c| (c.name.as_str(), c.definition.as_str()))
            .collect(),
    ));
    items.extend(named(
        DiffKind::ForeignKey,
        source
            .foreign_keys
            .iter()
            .map(|k| (k.name.as_str(), k.definition.as_str()))
            .collect(),
        target
            .foreign_keys
            .iter()
            .map(|k| (k.name.as_str(), k.definition.as_str()))
            .collect(),
    ));
    items
}

/// Indexes and constraints are matched by name and compared by definition.
fn named_items(
    kind: DiffKind,
    source: &[(&str, &str)],
    target: &[(&str, &str)],
    source_schema: &str,
    target_schema: &str,
) -> Vec<DiffItem> {
    let source: BTreeMap<&str, &str> = source.iter().copied().collect();
    let target: BTreeMap<&str, &str> = target.iter().copied().collect();
    let names: BTreeSet<&str> = source.keys().chain(target.keys()).copied().collect();
    names
        .into_iter()
        .filter_map(|name| {
            let (left, right) = (source.get(name), target.get(name));
            if let (Some(left), Some(right)) = (left, right)
                && unqualified(left, source_schema) == unqualified(right, target_schema)
            {
                return None;
            }
            Some(DiffItem {
                kind,
                name: name.to_string(),
                source: left.map(|text| text.to_string()),
                target: right.map(|text| text.to_string()),
            })
        })
        .collect()
}

/// "integer NOT NULL DEFAULT 0": what is compared and shown for a column.
fn column_text(column: &ColumnInfo) -> String {
    let mut text = column.data_type.clone();
    if !column.nullable {
        text.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default {
        text.push_str(&format!(" DEFAULT {default}"));
    }
    text
}

fn primary_key(structure: &TableStructure) -> Option<String> {
    let columns: Vec<&str> = structure
        .columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.as_str())
        .collect();
    (!columns.is_empty()).then(|| format!("({})", columns.join(", ")))
}

/// Where the catalog qualifies a name with the schema (`ON public.users`,
/// `REFERENCES public.teams`, `nextval('public.s')`), as written and as quoted.
fn qualifiers(schema: &str) -> Vec<String> {
    let quoted = format!("\"{}\".", schema.replace('"', "\"\""));
    [" ", "(", "'"]
        .into_iter()
        .flat_map(|before| [format!("{before}{schema}."), format!("{before}{quoted}")])
        .collect()
}

/// The definition without its own schema's name: two schemas named differently
/// (dev, prod) must not differ in every index for that alone.
// ponytail: plain text replacement; a string literal holding "<schema>." changes too
fn unqualified(definition: &str, schema: &str) -> String {
    qualifiers(schema)
        .into_iter()
        .fold(definition.to_string(), |text, qualifier| {
            let before = &qualifier[..1];
            text.replace(&qualifier, before)
        })
}

/// The same definition, pointing at the target schema instead of the source one.
fn retarget(definition: &str, source_schema: &str, target_schema: &str) -> String {
    if source_schema == target_schema {
        return definition.to_string();
    }
    let target = Dialect::Postgres.quote_ident(target_schema);
    qualifiers(source_schema)
        .into_iter()
        .fold(definition.to_string(), |text, qualifier| {
            let before = &qualifier[..1];
            text.replace(&qualifier, &format!("{before}{target}."))
        })
}

/// Statements that bring the target to the source: new tables, then per table drops,
/// column changes and additions, then foreign keys (they may point at new tables), and
/// last the tables only the target has.
fn postgres_ddl(
    diff: &SchemaDiff,
    source_tables: &Tables,
    target_tables: &Tables,
    created: &[String],
    source_schema: &str,
    target_schema: &str,
) -> Result<String, AppError> {
    let dialect = Dialect::Postgres;
    let q = |name: &str| dialect.quote_ident(name);
    let change = |table: &str, change: SchemaChange| {
        sql_builder::schema_sql(dialect, target_schema, table, &change).map(|sql| format!("{sql};"))
    };
    let structure = |tables: &Tables, table: &str| {
        tables
            .iter()
            .find(|(name, _)| name == table)
            .map(|(_, structure)| structure.clone())
            .ok_or_else(|| AppError::not_found(&format!("tabela {table}")))
    };
    let mut statements: Vec<String> = created
        .iter()
        .map(|sql| retarget(sql, source_schema, target_schema))
        .collect();
    let mut foreign_keys = Vec::new();

    for TableDiff { table, items } in &diff.changed {
        let (source, target) = (
            structure(source_tables, table)?,
            structure(target_tables, table)?,
        );
        let table_ref = format!("{}.{}", q(target_schema), q(table));
        // an index behind a constraint comes and goes with the constraint
        // ponytail: the primary key's index is known by Postgres' default name only
        let primary_index = format!("{table}_pkey");
        let backs_constraint = |name: &str| {
            name == primary_index
                || source.constraints.iter().any(|c| c.name == name)
                || target.constraints.iter().any(|c| c.name == name)
        };
        // what goes or changes is dropped first
        for item in items {
            match (item.kind, &item.target) {
                (DiffKind::ForeignKey | DiffKind::Constraint, Some(_)) => {
                    statements.push(change(
                        table,
                        SchemaChange::DropConstraint {
                            name: item.name.clone(),
                        },
                    )?);
                }
                (DiffKind::Index, Some(_)) if !backs_constraint(&item.name) => {
                    statements.push(change(
                        table,
                        SchemaChange::DropIndex {
                            name: item.name.clone(),
                        },
                    )?);
                }
                _ => {}
            }
        }
        for item in items.iter().filter(|item| item.kind == DiffKind::Column) {
            let from = source.columns.iter().find(|c| c.name == item.name);
            let to = target.columns.iter().find(|c| c.name == item.name);
            let column = item.name.clone();
            match (from, to) {
                (Some(from), None) => statements.push(change(
                    table,
                    SchemaChange::AddColumn {
                        column: ColumnDefinition {
                            name: column,
                            data_type: from.data_type.clone(),
                            nullable: from.nullable,
                            default: from.default.clone(),
                        },
                    },
                )?),
                (None, Some(_)) => {
                    statements.push(change(table, SchemaChange::DropColumn { column })?);
                }
                (Some(from), Some(to)) => {
                    if from.data_type != to.data_type {
                        statements.push(change(
                            table,
                            SchemaChange::SetType {
                                column: column.clone(),
                                data_type: from.data_type.clone(),
                                using: None,
                            },
                        )?);
                    }
                    if from.default != to.default {
                        statements.push(change(
                            table,
                            SchemaChange::SetDefault {
                                column: column.clone(),
                                default: from.default.clone(),
                            },
                        )?);
                    }
                    if from.nullable != to.nullable {
                        statements.push(change(
                            table,
                            SchemaChange::SetNullable {
                                column,
                                nullable: from.nullable,
                            },
                        )?);
                    }
                }
                (None, None) => {}
            }
        }
        for item in items {
            let Some(definition) = &item.source else {
                continue;
            };
            let definition = retarget(definition, source_schema, target_schema);
            match item.kind {
                DiffKind::PrimaryKey => statements.push(format!(
                    "-- {table}: chave primária {} na origem, {} no destino; ajuste à mão",
                    definition,
                    item.target.as_deref().unwrap_or("nenhuma")
                )),
                DiffKind::Constraint => statements.push(format!(
                    "ALTER TABLE {table_ref} ADD CONSTRAINT {} {definition};",
                    q(&item.name)
                )),
                DiffKind::ForeignKey => foreign_keys.push(format!(
                    "ALTER TABLE {table_ref} ADD CONSTRAINT {} {definition};",
                    q(&item.name)
                )),
                DiffKind::Index if !backs_constraint(&item.name) => {
                    statements.push(format!("{definition};"));
                }
                DiffKind::Index | DiffKind::Column => {}
            }
        }
    }
    statements.extend(foreign_keys);
    for table in &diff.only_in_target {
        statements.push(format!("-- destrutivo: {table} só existe no destino"));
        statements.push(change(table, SchemaChange::DropTable)?);
    }
    Ok(statements.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ConstraintInfo, ForeignKeyInfo, IndexInfo};

    fn column(name: &str, data_type: &str, nullable: bool, default: Option<&str>) -> ColumnInfo {
        ColumnInfo {
            name: name.into(),
            data_type: data_type.into(),
            nullable,
            default: default.map(Into::into),
            is_primary_key: name == "id",
            options: Vec::new(),
        }
    }

    fn table(columns: Vec<ColumnInfo>) -> TableStructure {
        TableStructure {
            columns,
            indexes: Vec::new(),
            foreign_keys: Vec::new(),
            constraints: Vec::new(),
        }
    }

    #[test]
    fn tables_columns_and_named_objects_are_compared() {
        let mut users = table(vec![
            column("id", "integer", false, None),
            column("name", "text", false, Some("'x'::text")),
            column("email", "text", true, None),
        ]);
        users.indexes = vec![
            IndexInfo {
                name: "users_pkey".into(),
                definition: "CREATE UNIQUE INDEX users_pkey ON dev.users USING btree (id)".into(),
            },
            IndexInfo {
                name: "users_name_idx".into(),
                definition: "CREATE INDEX users_name_idx ON dev.users USING btree (name)".into(),
            },
        ];
        users.constraints = vec![ConstraintInfo {
            name: "users_email_key".into(),
            definition: "UNIQUE (email)".into(),
        }];
        users.foreign_keys = vec![ForeignKeyInfo {
            name: "users_team_fkey".into(),
            definition: "FOREIGN KEY (team) REFERENCES dev.teams(id)".into(),
            columns: vec!["team".into()],
            referenced_schema: "dev".into(),
            referenced_table: "teams".into(),
            referenced_columns: vec!["id".into()],
        }];
        let mut prod_users = table(vec![
            column("id", "integer", false, None),
            column("name", "character varying(10)", true, None),
            column("legacy", "integer", true, None),
        ]);
        // the same index and key under another schema's name are no difference
        prod_users.indexes = vec![IndexInfo {
            name: "users_pkey".into(),
            definition: "CREATE UNIQUE INDEX users_pkey ON \"Prod\".users USING btree (id)".into(),
        }];
        prod_users.foreign_keys = vec![ForeignKeyInfo {
            definition: "FOREIGN KEY (team) REFERENCES \"Prod\".teams(id)".into(),
            ..users.foreign_keys[0].clone()
        }];
        let same = table(vec![column("id", "integer", false, None)]);
        let source = vec![
            ("users".to_string(), users),
            ("teams".to_string(), same.clone()),
            ("new".to_string(), same.clone()),
        ];
        let target = vec![
            ("old".to_string(), same.clone()),
            ("teams".to_string(), same),
            ("users".to_string(), prod_users),
        ];

        let diff = compare_tables(&source, &target, "dev", "Prod");

        assert_eq!(diff.only_in_source, ["new"]);
        assert_eq!(diff.only_in_target, ["old"]);
        assert_eq!(diff.equal, 1);
        assert_eq!(diff.changed.len(), 1);
        let found: Vec<(DiffKind, &str, bool, bool)> = diff.changed[0]
            .items
            .iter()
            .map(|item| {
                (
                    item.kind,
                    item.name.as_str(),
                    item.source.is_some(),
                    item.target.is_some(),
                )
            })
            .collect();
        assert_eq!(
            found,
            [
                (DiffKind::Column, "name", true, true),
                (DiffKind::Column, "email", true, false),
                (DiffKind::Column, "legacy", false, true),
                (DiffKind::Index, "users_name_idx", true, false),
                (DiffKind::Constraint, "users_email_key", true, false),
            ]
        );
        assert_eq!(
            diff.changed[0].items[0].source.as_deref(),
            Some("text NOT NULL DEFAULT 'x'::text")
        );
    }

    #[test]
    fn postgres_ddl_brings_the_target_to_the_source() {
        let mut users = table(vec![
            column("id", "integer", false, None),
            column("name", "text", false, Some("'x'::text")),
            column("email", "text", true, None),
        ]);
        users.indexes = vec![
            IndexInfo {
                name: "users_email_key".into(),
                definition: "CREATE UNIQUE INDEX users_email_key ON dev.users USING btree (email)"
                    .into(),
            },
            IndexInfo {
                name: "users_name_idx".into(),
                definition: "CREATE INDEX users_name_idx ON dev.users USING btree (name)".into(),
            },
        ];
        users.constraints = vec![ConstraintInfo {
            name: "users_email_key".into(),
            definition: "UNIQUE (email)".into(),
        }];
        users.foreign_keys = vec![ForeignKeyInfo {
            name: "users_team_fkey".into(),
            definition: "FOREIGN KEY (id) REFERENCES dev.teams(id)".into(),
            columns: vec!["id".into()],
            referenced_schema: "dev".into(),
            referenced_table: "teams".into(),
            referenced_columns: vec!["id".into()],
        }];
        let mut prod_users = table(vec![
            column("id", "bigint", false, None),
            column("name", "text", true, None),
            column("legacy", "integer", true, None),
        ]);
        prod_users.indexes = vec![IndexInfo {
            name: "users_legacy_idx".into(),
            definition: "CREATE INDEX users_legacy_idx ON prod.users USING btree (legacy)".into(),
        }];
        let source = vec![("users".to_string(), users)];
        let target = vec![
            ("users".to_string(), prod_users),
            (
                "old".to_string(),
                table(vec![column("id", "integer", false, None)]),
            ),
        ];
        let mut diff = compare_tables(&source, &target, "dev", "prod");
        diff.only_in_source = vec!["fresh".into()];
        let created = ["CREATE TABLE \"dev\".\"fresh\" (\n    \"id\" integer\n);".to_string()];

        let ddl = postgres_ddl(&diff, &source, &target, &created, "dev", "prod").unwrap();

        assert_eq!(
            ddl.lines().collect::<Vec<_>>(),
            [
                "CREATE TABLE \"prod\".\"fresh\" (",
                "    \"id\" integer",
                ");",
                "DROP INDEX \"prod\".\"users_legacy_idx\";",
                "ALTER TABLE \"prod\".\"users\" ALTER COLUMN \"id\" TYPE integer;",
                "ALTER TABLE \"prod\".\"users\" ALTER COLUMN \"name\" SET DEFAULT 'x'::text;",
                "ALTER TABLE \"prod\".\"users\" ALTER COLUMN \"name\" SET NOT NULL;",
                "ALTER TABLE \"prod\".\"users\" ADD COLUMN \"email\" text;",
                "ALTER TABLE \"prod\".\"users\" DROP COLUMN \"legacy\";",
                "CREATE INDEX users_name_idx ON \"prod\".users USING btree (name);",
                "ALTER TABLE \"prod\".\"users\" ADD CONSTRAINT \"users_email_key\" UNIQUE (email);",
                "ALTER TABLE \"prod\".\"users\" ADD CONSTRAINT \"users_team_fkey\" FOREIGN KEY (id) REFERENCES \"prod\".teams(id);",
                "-- destrutivo: old só existe no destino",
                "DROP TABLE \"prod\".\"old\";",
            ]
        );
    }

    #[test]
    fn schema_names_are_unqualified_and_retargeted() {
        assert_eq!(
            unqualified(
                "DEFAULT nextval('dev.s'::regclass) ON dev.t (\"dev\".x)",
                "dev"
            ),
            "DEFAULT nextval('s'::regclass) ON t (x)"
        );
        // only a qualifier: a name that merely starts with the schema stays
        assert_eq!(unqualified("ON developers.t", "dev"), "ON developers.t");
        assert_eq!(retarget("ON dev.t", "dev", "Prod"), "ON \"Prod\".t");
        assert_eq!(retarget("ON dev.t", "dev", "dev"), "ON dev.t");
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::adapters::mysql::MysqlAdapter;
    use crate::adapters::postgres::PostgresAdapter;
    use crate::adapters::sqlite::SqliteAdapter;
    use crate::adapters::{mysql, postgres, sqlite};
    use crate::domain::Environment;
    use crate::registry::{Live, OpenConnection};

    fn register(registry: &Registry, id: &str, connection: SqlConnection) {
        registry.insert_connection(
            id,
            OpenConnection {
                live: Live::Sql(connection),
                name: id.into(),
                environment: Environment::Local,
                read_only: false,
                tunnel: None,
            },
        );
    }

    async fn script(connection: &SqlConnection, sql: &str) {
        let statements = connection.dialect().split(sql);
        connection
            .run_script(&statements, 1, |_| {})
            .await
            .unwrap_or_else(|err| panic!("{err}: {sql}"));
    }

    #[tokio::test]
    async fn postgres_ddl_applied_to_the_target_leaves_no_difference() {
        let (_container, config) = postgres::integration_tests::start().await;
        let registry = Registry::default();
        for id in ["dev", "prod"] {
            let adapter = PostgresAdapter::connect(&config, Some("postgres".into()), false)
                .await
                .unwrap();
            register(&registry, id, SqlConnection::Postgres(adapter));
        }
        let dev = registry.connection("dev").unwrap();
        script(
            dev.sql().unwrap(),
            "CREATE SCHEMA dev;
             CREATE SCHEMA prod;
             CREATE TABLE dev.teams (id integer PRIMARY KEY, name text NOT NULL DEFAULT 'x');
             CREATE TABLE dev.users (
                 id integer PRIMARY KEY,
                 team_id integer REFERENCES dev.teams (id),
                 email text UNIQUE,
                 age integer CHECK (age > 0)
             );
             CREATE INDEX users_team_idx ON dev.users (team_id);
             CREATE TABLE dev.only_dev (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, note text);
             CREATE TABLE prod.teams (id integer PRIMARY KEY, name varchar(10));
             CREATE TABLE prod.users (id integer PRIMARY KEY, team_id integer, legacy integer);
             CREATE TABLE prod.only_prod (id integer);",
        )
        .await;

        let diff = compare(&registry, "dev", "dev", "prod", "prod")
            .await
            .unwrap();
        assert_eq!(diff.only_in_source, ["only_dev"]);
        assert_eq!(diff.only_in_target, ["only_prod"]);
        let changed: Vec<&str> = diff.changed.iter().map(|t| t.table.as_str()).collect();
        assert_eq!(changed, ["teams", "users"]);
        let ddl = diff.ddl.expect("Postgres has a DDL generator");
        assert!(ddl.contains("DROP TABLE \"prod\".\"only_prod\";"), "{ddl}");

        // the target, brought to the source by the suggested DDL, is the source
        let prod = registry.connection("prod").unwrap();
        script(prod.sql().unwrap(), &ddl).await;
        let again = compare(&registry, "dev", "dev", "prod", "prod")
            .await
            .unwrap();
        assert!(again.only_in_source.is_empty(), "{again:?}");
        assert!(again.only_in_target.is_empty(), "{again:?}");
        assert!(again.changed.is_empty(), "{:#?}\n{ddl}", again.changed);
        assert_eq!(again.equal, 3);
        assert_eq!(again.ddl.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn mysql_lists_differences_without_ddl_and_engines_must_match() {
        let (_container, config) = mysql::integration_tests::start().await;
        let registry = Registry::default();
        let connection = MysqlAdapter::connect(&config, None, false).await.unwrap();
        register(&registry, "a", SqlConnection::Mysql(connection));
        let connection = MysqlAdapter::connect(&config, None, false).await.unwrap();
        register(&registry, "b", SqlConnection::Mysql(connection));
        let a = registry.connection("a").unwrap();
        script(
            a.sql().unwrap(),
            "CREATE DATABASE left_db;
             CREATE DATABASE right_db;
             CREATE TABLE left_db.t (id int PRIMARY KEY, name varchar(20) NOT NULL);
             CREATE TABLE right_db.t (id int PRIMARY KEY, name varchar(10));
             CREATE TABLE right_db.extra (id int);",
        )
        .await;

        let diff = compare(&registry, "a", "left_db", "b", "right_db")
            .await
            .unwrap();
        assert_eq!(diff.ddl, None);
        assert_eq!(diff.only_in_target, ["extra"]);
        assert_eq!(diff.changed[0].items[0].name, "name");

        // another engine is refused before any catalog read
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("other.db");
        std::fs::File::create(&path).unwrap();
        let sqlite = SqliteAdapter::connect(&sqlite::integration_tests::config(&path), false)
            .await
            .unwrap();
        register(&registry, "file", SqlConnection::Sqlite(sqlite));
        assert!(matches!(
            compare(&registry, "a", "left_db", "file", "main").await,
            Err(AppError::Validation(_))
        ));
    }
}
