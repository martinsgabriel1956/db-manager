use std::time::Instant;

use mongodb::bson::{Bson, Document, doc};

use crate::adapters::mongo::ejson;
use crate::domain::{
    AggregateOutcome, AggregateResponse, AppError, Confirmation, DocumentPage, DocumentWrite,
    Environment, FindRequest, IndexInfo, IndexKind, IndexResponse, NewIndex, WriteRequest,
    WriteResponse,
};
use crate::registry::Registry;
use crate::storage::history::HistoryStore;
use crate::use_cases::sql::{MAX_PAGE_SIZE, elapsed_ms, record};

const PROD_REASON: &str = "Conexão de produção: confirme antes de escrever";

pub async fn browse_collection(
    registry: &Registry,
    connection_id: &str,
    request: FindRequest,
) -> Result<DocumentPage, AppError> {
    if request.page_size == 0 || request.page_size > MAX_PAGE_SIZE {
        return Err(AppError::validation(format!(
            "tamanho de página deve ser entre 1 e {MAX_PAGE_SIZE}"
        )));
    }
    registry
        .connection(connection_id)?
        .mongo()?
        .find(&request)
        .await
}

pub async fn collection_indexes(
    registry: &Registry,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<Vec<IndexInfo>, AppError> {
    registry
        .connection(connection_id)?
        .mongo()?
        .indexes(database, collection)
        .await
}

/// The createIndexes command for one index, as Extended JSON text (what the UI
/// previews and confirms) with the command itself.
fn create_index_command(index: &NewIndex) -> Result<(String, Document), AppError> {
    if index.keys.is_empty() {
        return Err(AppError::validation(
            "o índice precisa de ao menos uma chave",
        ));
    }
    let mut key = Document::new();
    for index_key in &index.keys {
        let field = index_key.field.trim();
        if field.is_empty() {
            return Err(AppError::validation("toda chave precisa de um campo"));
        }
        if key.contains_key(field) {
            return Err(AppError::validation(format!(
                "campo repetido nas chaves: {field}"
            )));
        }
        let value = match index_key.kind {
            IndexKind::Asc => Bson::Int32(1),
            IndexKind::Desc => Bson::Int32(-1),
            IndexKind::Text => "text".into(),
            IndexKind::Hashed => "hashed".into(),
            IndexKind::Sphere2d => "2dsphere".into(),
            IndexKind::Flat2d => "2d".into(),
        };
        key.insert(field, value);
    }
    // the drivers' default name: field_value for each key
    let name = match index.name.trim() {
        "" => key
            .iter()
            .map(|(field, value)| match value {
                Bson::String(kind) => format!("{field}_{kind}"),
                other => format!("{field}_{other}"),
            })
            .collect::<Vec<_>>()
            .join("_"),
        name => name.to_string(),
    };
    let mut spec = doc! { "key": key, "name": name };
    if index.unique {
        spec.insert("unique", true);
    }
    if index.sparse {
        spec.insert("sparse", true);
    }
    if let Some(seconds) = index.expire_after_seconds {
        let seconds = i32::try_from(seconds)
            .map_err(|_| AppError::validation("expireAfterSeconds grande demais"))?;
        spec.insert("expireAfterSeconds", seconds);
    }
    let filter = ejson::parse_document(&index.partial_filter, "partialFilterExpression")?;
    if !filter.is_empty() {
        spec.insert("partialFilterExpression", filter);
    }
    let command = doc! { "createIndexes": index.collection.as_str(), "indexes": [spec] };
    let statement = format!(
        "{}.runCommand({})",
        index.database,
        ejson::to_text(command.clone())
    );
    Ok((statement, command))
}

/// The exact command `create_index` would run, for the form to show while it is filled.
pub fn index_statement(index: &NewIndex) -> Result<String, AppError> {
    create_index_command(index).map(|(statement, _)| statement)
}

/// Refused on read-only connections, confirmed on prod.
pub async fn create_index(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    index: NewIndex,
    confirmed: bool,
) -> Result<IndexResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let mongo = connection.mongo()?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let (statement, command) = create_index_command(&index)?;
    if connection.environment == Environment::Prod && !confirmed {
        return Ok(IndexResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: PROD_REASON.to_string(),
                statements: vec![statement],
                destructive: false,
            },
        });
    }
    let started = Instant::now();
    let result = mongo.run_command(&index.database, command).await;
    record(
        history,
        connection_id,
        &connection,
        &statement,
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    result.map(|()| IndexResponse::Applied)
}

/// Destructive: always confirmed. `_id_` cannot be dropped, and `*` (which
/// dropIndexes reads as "every index") is refused.
#[allow(clippy::too_many_arguments)]
pub async fn drop_index(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    database: &str,
    collection: &str,
    name: &str,
    confirmed: bool,
) -> Result<IndexResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let mongo = connection.mongo()?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    match name {
        "_id_" => return Err(AppError::validation("o índice _id_ não pode ser removido")),
        "" | "*" => return Err(AppError::validation("informe o nome de um índice")),
        _ => {}
    }
    let command = doc! { "dropIndexes": collection, "index": name };
    let statement = format!("{database}.runCommand({})", ejson::to_text(command.clone()));
    if !confirmed {
        return Ok(IndexResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: "Comando destrutivo: remove o índice".to_string(),
                statements: vec![statement],
                destructive: true,
            },
        });
    }
    let started = Instant::now();
    let result = mongo.run_command(database, command).await;
    record(
        history,
        connection_id,
        &connection,
        &statement,
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    result.map(|()| IndexResponse::Applied)
}

#[derive(Debug, Default, PartialEq, Eq)]
struct PipelineRisk {
    /// $out or $merge write to a collection
    writes: bool,
    /// $out replaces its target collection entirely
    replaces: bool,
}

fn pipeline_risk(pipeline: &[Document]) -> PipelineRisk {
    let mut risk = PipelineRisk::default();
    for stage in pipeline {
        if stage.contains_key("$out") {
            risk.writes = true;
            risk.replaces = true;
        }
        if stage.contains_key("$merge") {
            risk.writes = true;
        }
    }
    risk
}

/// Runs a pipeline tagged with `run_id` (so `cancel_run` can kill it). Writing
/// stages are refused on read-only connections and confirmed when destructive or on prod.
#[allow(clippy::too_many_arguments)]
pub async fn run_aggregation(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    run_id: &str,
    database: &str,
    collection: &str,
    pipeline_text: &str,
    confirmed: bool,
) -> Result<AggregateResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let mongo = connection.mongo()?;
    let pipeline = ejson::parse_pipeline(pipeline_text)?;
    let risk = pipeline_risk(&pipeline);
    if risk.writes && connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }

    let statement = format!(
        "{database}.{collection}.aggregate({})",
        pipeline_text.trim()
    );
    if !confirmed {
        let reason = if risk.replaces {
            Some("Comando destrutivo: $out substitui a coleção de destino")
        } else if risk.writes && connection.environment == Environment::Prod {
            Some(PROD_REASON)
        } else {
            None
        };
        if let Some(reason) = reason {
            return Ok(AggregateResponse::NeedsConfirmation {
                confirmation: Confirmation {
                    reason: reason.to_string(),
                    statements: vec![statement],
                    destructive: risk.replaces,
                },
            });
        }
    }

    registry.start_run(run_id, connection.clone(), 0);
    let started = Instant::now();
    let result = mongo
        .aggregate(database, collection, pipeline, run_id)
        .await;
    registry.finish_run(run_id);
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        &connection,
        &statement,
        duration_ms,
        result.as_ref().err(),
    )
    .await;

    let (documents, truncated) = result?;
    Ok(AggregateResponse::Executed {
        outcome: AggregateOutcome {
            documents,
            truncated,
            duration_ms,
        },
    })
}

/// Inserts, replaces or deletes one document. Refused on read-only connections,
/// confirmed on prod.
pub async fn write_document(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    request: WriteRequest,
    confirmed: bool,
) -> Result<WriteResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let mongo = connection.mongo()?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let WriteRequest {
        database,
        collection,
        write,
    } = request;
    let target = format!("{database}.{collection}");

    // parse everything before asking for confirmation: invalid input is an error, not a question
    let statement = match &write {
        DocumentWrite::Insert { document } => {
            ejson::parse_document(document, "documento")?;
            format!("{target}.insertOne({})", document.trim())
        }
        DocumentWrite::Replace { id, document } => {
            check_same_id(
                &ejson::parse_value(id, "_id")?,
                &ejson::parse_document(document, "documento")?,
            )?;
            format!(
                r#"{target}.replaceOne({{"_id": {}}}, {})"#,
                id.trim(),
                document.trim()
            )
        }
        DocumentWrite::Delete { id } => {
            ejson::parse_value(id, "_id")?;
            format!(r#"{target}.deleteOne({{"_id": {}}})"#, id.trim())
        }
    };
    if connection.environment == Environment::Prod && !confirmed {
        return Ok(WriteResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason: PROD_REASON.to_string(),
                statements: vec![statement],
                destructive: false,
            },
        });
    }

    let started = Instant::now();
    let result = match write {
        DocumentWrite::Insert { document } => {
            mongo
                .insert(
                    &database,
                    &collection,
                    ejson::parse_document(&document, "documento")?,
                )
                .await
        }
        DocumentWrite::Replace { id, document } => {
            let document = ejson::parse_document(&document, "documento")?;
            mongo
                .replace(
                    &database,
                    &collection,
                    ejson::parse_value(&id, "_id")?,
                    document,
                )
                .await
                .map(|()| id)
        }
        DocumentWrite::Delete { id } => mongo
            .delete(&database, &collection, ejson::parse_value(&id, "_id")?)
            .await
            .map(|()| id),
    };
    record(
        history,
        connection_id,
        &connection,
        &statement,
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    Ok(WriteResponse::Written { id: result? })
}

/// The _id is immutable: a replacement may omit it but not change it.
fn check_same_id(id: &mongodb::bson::Bson, document: &Document) -> Result<(), AppError> {
    match document.get("_id") {
        Some(new_id) if new_id != id => {
            Err(AppError::validation("o _id de um documento não pode mudar"))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{Bson, doc};

    #[test]
    fn pipeline_risks() {
        let read = vec![doc! { "$match": {} }, doc! { "$group": { "_id": "$kind" } }];
        let merge = vec![doc! { "$match": {} }, doc! { "$merge": "summary" }];
        let out = vec![doc! { "$out": "summary" }];

        assert_eq!(pipeline_risk(&read), PipelineRisk::default());
        assert_eq!(
            pipeline_risk(&merge),
            PipelineRisk {
                writes: true,
                replaces: false
            }
        );
        assert_eq!(
            pipeline_risk(&out),
            PipelineRisk {
                writes: true,
                replaces: true
            }
        );
    }

    fn index(keys: Vec<(&str, IndexKind)>) -> NewIndex {
        NewIndex {
            database: "shop".into(),
            collection: "items".into(),
            keys: keys
                .into_iter()
                .map(|(field, kind)| crate::domain::IndexKey {
                    field: field.into(),
                    kind,
                })
                .collect(),
            name: String::new(),
            unique: false,
            sparse: false,
            expire_after_seconds: None,
            partial_filter: String::new(),
        }
    }

    #[test]
    fn index_commands() {
        let compound = index(vec![("kind", IndexKind::Asc), ("n", IndexKind::Desc)]);
        assert_eq!(
            index_statement(&compound).unwrap(),
            r#"shop.runCommand({"createIndexes":"items","indexes":[{"key":{"kind":1,"n":-1},"name":"kind_1_n_-1"}]})"#
        );

        let mut ttl = index(vec![("at", IndexKind::Asc)]);
        ttl.name = "expira".into();
        ttl.unique = true;
        ttl.expire_after_seconds = Some(3600);
        ttl.partial_filter = r#"{"n": {"$gt": {"$numberLong": "5"}}}"#.into();
        assert_eq!(
            index_statement(&ttl).unwrap(),
            r#"shop.runCommand({"createIndexes":"items","indexes":[{"key":{"at":1},"name":"expira","unique":true,"expireAfterSeconds":3600,"partialFilterExpression":{"n":{"$gt":{"$numberLong":"5"}}}}]})"#
        );

        assert!(
            index_statement(&index(vec![("loc", IndexKind::Sphere2d)]))
                .unwrap()
                .contains(r#""key":{"loc":"2dsphere"},"name":"loc_2dsphere""#)
        );
        for bad in [
            index(vec![]),
            index(vec![(" ", IndexKind::Asc)]),
            index(vec![("a", IndexKind::Asc), ("a", IndexKind::Desc)]),
        ] {
            assert!(matches!(
                index_statement(&bad),
                Err(AppError::Validation(_))
            ));
        }
        let mut bad_filter = index(vec![("a", IndexKind::Asc)]);
        bad_filter.partial_filter = "[1]".into();
        assert!(index_statement(&bad_filter).is_err());
    }

    #[test]
    fn ids_cannot_change() {
        let id = Bson::Int32(1);
        assert!(check_same_id(&id, &doc! { "name": "a" }).is_ok());
        assert!(check_same_id(&id, &doc! { "_id": 1, "name": "a" }).is_ok());
        assert!(check_same_id(&id, &doc! { "_id": 2 }).is_err());
        // same number, other type: still a different _id
        assert!(check_same_id(&id, &doc! { "_id": 1_i64 }).is_err());
    }
}

#[cfg(test)]
mod integration_tests {
    use std::time::Duration;

    use super::*;
    use crate::adapters::mongo::integration_tests::start;
    use crate::domain::{ConnectionConfig, Target};
    use crate::storage::secrets::SecretStore;
    use crate::use_cases::sql;

    /// Hands out the connection string when the target is a URI.
    struct Secret(Option<String>);

    impl SecretStore for Secret {
        fn get(&self, _: &str) -> Result<Option<String>, AppError> {
            Ok(self.0.clone())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AppError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), AppError> {
            Ok(())
        }
    }

    async fn open(registry: &Registry, config: &ConnectionConfig) {
        sql::disconnect(registry, &config.id).await;
        sql::connect(registry, &Secret(None), config.clone())
            .await
            .unwrap();
    }

    fn write(write: DocumentWrite) -> WriteRequest {
        WriteRequest {
            database: "shop".into(),
            collection: "items".into(),
            write,
        }
    }

    async fn aggregate(
        registry: &Registry,
        history: &HistoryStore,
        pipeline: &str,
        confirmed: bool,
    ) -> Result<AggregateResponse, AppError> {
        run_aggregation(
            registry, history, "mongo", "run", "shop", "items", pipeline, confirmed,
        )
        .await
    }

    #[tokio::test]
    async fn rules_for_writes_through_the_registry() {
        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        open(&registry, &config).await;

        // the generic tree lists databases and collections
        let written = write_document(
            &registry,
            &history,
            "mongo",
            write(DocumentWrite::Insert {
                document: r#"{"_id": 1, "kind": "a"}"#.into(),
            }),
            false,
        )
        .await
        .unwrap();
        assert_eq!(written, WriteResponse::Written { id: "1".into() });
        let schemas = sql::list_schemas(&registry, "mongo").await.unwrap();
        assert_eq!(schemas[0].name, "shop");

        let page = browse_collection(
            &registry,
            "mongo",
            FindRequest {
                database: "shop".into(),
                collection: "items".into(),
                filter: String::new(),
                sort: String::new(),
                projection: String::new(),
                page: 0,
                page_size: 10,
            },
        )
        .await
        .unwrap();
        assert_eq!(page.documents, vec![r#"{"_id":1,"kind":"a"}"#]);

        // replacing must not change the _id
        let changed_id = write_document(
            &registry,
            &history,
            "mongo",
            write(DocumentWrite::Replace {
                id: "1".into(),
                document: r#"{"_id": 2}"#.into(),
            }),
            false,
        )
        .await
        .unwrap_err();
        assert!(matches!(changed_id, AppError::Validation(_)));

        // $out replaces a collection: confirm on any environment
        let out = aggregate(&registry, &history, r#"[{"$out": "copy"}]"#, false)
            .await
            .unwrap();
        let AggregateResponse::NeedsConfirmation { confirmation } = out else {
            panic!("expected confirmation");
        };
        assert_eq!(
            confirmation.statements,
            vec![r#"shop.items.aggregate([{"$out": "copy"}])"#]
        );
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$out": "copy"}]"#, true)
                .await
                .unwrap(),
            AggregateResponse::Executed { .. }
        ));
        // $merge writes but only asks on prod
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$merge": "copy"}]"#, false)
                .await
                .unwrap(),
            AggregateResponse::Executed { .. }
        ));

        let recorded = history.search("", Some("mongo"), false, 10).await.unwrap();
        // insert, the confirmed $out and $merge; the invalid replace never ran
        assert_eq!(recorded.len(), 3);
        assert!(
            recorded
                .iter()
                .any(|e| e.sql == r#"shop.items.insertOne({"_id": 1, "kind": "a"})"#)
        );

        // prod: every write asks, reads do not
        config.environment = Environment::Prod;
        open(&registry, &config).await;
        let delete = || write(DocumentWrite::Delete { id: "1".into() });
        let response = write_document(&registry, &history, "mongo", delete(), false)
            .await
            .unwrap();
        let WriteResponse::NeedsConfirmation { confirmation } = response else {
            panic!("expected confirmation");
        };
        assert_eq!(
            confirmation.statements,
            vec![r#"shop.items.deleteOne({"_id": 1})"#]
        );
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$merge": "copy"}]"#, false)
                .await
                .unwrap(),
            AggregateResponse::NeedsConfirmation { .. }
        ));
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$match": {}}]"#, false)
                .await
                .unwrap(),
            AggregateResponse::Executed { .. }
        ));
        assert_eq!(
            write_document(&registry, &history, "mongo", delete(), true)
                .await
                .unwrap(),
            WriteResponse::Written { id: "1".into() }
        );

        // read-only: refused before reaching the server
        config.read_only = true;
        open(&registry, &config).await;
        assert!(matches!(
            write_document(&registry, &history, "mongo", delete(), true).await,
            Err(AppError::ReadOnly(_))
        ));
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$merge": "copy"}]"#, true).await,
            Err(AppError::ReadOnly(_))
        ));
        assert!(matches!(
            aggregate(&registry, &history, r#"[{"$match": {}}]"#, false)
                .await
                .unwrap(),
            AggregateResponse::Executed { .. }
        ));
    }

    #[tokio::test]
    async fn indexes_are_created_and_dropped_under_the_write_rules() {
        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        open(&registry, &config).await;
        let new_index = |field: &str| NewIndex {
            database: "shop".into(),
            collection: "items".into(),
            keys: vec![crate::domain::IndexKey {
                field: field.into(),
                kind: IndexKind::Asc,
            }],
            name: String::new(),
            unique: false,
            sparse: false,
            expire_after_seconds: None,
            partial_filter: String::new(),
        };
        let create = |index: NewIndex, confirmed: bool| {
            create_index(&registry, &history, "mongo", index, confirmed)
        };
        let drop = |name: &'static str, confirmed: bool| {
            drop_index(
                &registry, &history, "mongo", "shop", "items", name, confirmed,
            )
        };
        async fn definitions(registry: &Registry) -> Vec<String> {
            collection_indexes(registry, "mongo", "shop", "items")
                .await
                .unwrap()
                .into_iter()
                .map(|index| format!("{} {}", index.name, index.definition))
                .collect()
        }

        // local: creation runs at once (the form already showed the command)
        let mut email = new_index("email");
        email.unique = true;
        email.sparse = true;
        assert_eq!(create(email, false).await.unwrap(), IndexResponse::Applied);
        let mut ttl = new_index("at");
        ttl.name = "expira".into();
        ttl.expire_after_seconds = Some(60);
        ttl.partial_filter = r#"{"kind": "temp"}"#.into();
        assert_eq!(create(ttl, false).await.unwrap(), IndexResponse::Applied);
        assert_eq!(
            definitions(&registry).await,
            vec![
                r#"_id_ {"_id":1}"#,
                r#"email_1 {"email":1} UNIQUE SPARSE"#,
                r#"expira {"at":1} expireAfterSeconds: 60 partialFilterExpression: {"kind":"temp"}"#,
            ]
        );
        // the server's own errors come through
        let mut mixed = new_index("x");
        mixed.sparse = true;
        mixed.partial_filter = r#"{"x": 1}"#.into();
        assert!(matches!(
            create(mixed, false).await,
            Err(AppError::Database(_))
        ));

        // dropping always asks, and never _id_ or every index at once
        let response = drop("email_1", false).await.unwrap();
        let IndexResponse::NeedsConfirmation { confirmation } = response else {
            panic!("expected confirmation");
        };
        assert!(confirmation.destructive);
        assert_eq!(
            confirmation.statements,
            vec![r#"shop.runCommand({"dropIndexes":"items","index":"email_1"})"#]
        );
        assert_eq!(drop("email_1", true).await.unwrap(), IndexResponse::Applied);
        assert!(matches!(
            drop("_id_", true).await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            drop("*", true).await,
            Err(AppError::Validation(_))
        ));
        assert_eq!(definitions(&registry).await.len(), 2);

        let recorded = history.search("runCommand", None, false, 10).await.unwrap();
        // the two creations, the failed one and the confirmed drop
        assert_eq!(recorded.len(), 4);

        // prod: creating asks first, with the exact command
        config.environment = Environment::Prod;
        open(&registry, &config).await;
        let response = create(new_index("n"), false).await.unwrap();
        let IndexResponse::NeedsConfirmation { confirmation } = response else {
            panic!("expected confirmation");
        };
        assert!(!confirmation.destructive);
        assert_eq!(
            confirmation.statements,
            vec![
                r#"shop.runCommand({"createIndexes":"items","indexes":[{"key":{"n":1},"name":"n_1"}]})"#
            ]
        );
        assert_eq!(
            create(new_index("n"), true).await.unwrap(),
            IndexResponse::Applied
        );

        // read-only: refused before reaching the server
        config.read_only = true;
        open(&registry, &config).await;
        assert!(matches!(
            create(new_index("m"), true).await,
            Err(AppError::ReadOnly(_))
        ));
        assert!(matches!(
            drop("n_1", true).await,
            Err(AppError::ReadOnly(_))
        ));
    }

    #[tokio::test]
    async fn cancel_run_kills_the_aggregation_and_uri_connections_work() {
        let (_container, config) = start().await;
        let Target::Network { port, .. } = config.target.clone() else {
            unreachable!()
        };
        let uri_config = ConnectionConfig {
            target: Target::Uri {
                database: String::new(),
            },
            ..config
        };
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        sql::connect(
            &registry,
            &Secret(Some(format!("mongodb://127.0.0.1:{port}/shop"))),
            uri_config,
        )
        .await
        .unwrap();
        for n in 0..20 {
            write_document(
                &registry,
                &history,
                "mongo",
                write(DocumentWrite::Insert {
                    document: format!(r#"{{"n": {n}}}"#),
                }),
                false,
            )
            .await
            .unwrap();
        }

        let slow = r#"[{"$addFields": {"slept": {"$function": {"body": "function() { sleep(200); return true; }", "args": [], "lang": "js"}}}}]"#;
        let running = aggregate(&registry, &history, slow, false);
        let cancel = async {
            for _ in 0..50 {
                if registry.running("run").is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
            sql::cancel_run(&registry, "run").await.unwrap();
        };
        let (result, ()) = tokio::join!(running, cancel);

        assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
        assert!(registry.running("run").is_none());
        let recorded = history.search("$function", None, false, 10).await.unwrap();
        assert_eq!(recorded[0].error.as_deref(), Some("query cancelada"));
    }
}
