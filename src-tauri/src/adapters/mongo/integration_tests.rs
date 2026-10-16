//! Runs against a real MongoDB in Docker (testcontainers). One container per test.

use std::time::{Duration, Instant};

use mongodb::bson::{Document, doc};
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::ContainerAsync;
use testcontainers_modules::testcontainers::runners::AsyncRunner;

use super::{MAX_AGGREGATE_DOCUMENTS, MongoAdapter, ejson};
use crate::domain::{
    AppError, ConnectionConfig, Engine, Environment, FindRequest, RelationKind, Target, TlsConfig,
    TlsMode,
};

pub(crate) async fn start() -> (ContainerAsync<Mongo>, ConnectionConfig) {
    let container = Mongo::default()
        .start()
        .await
        .expect("docker is required for integration tests");
    let port = container.get_host_port_ipv4(27017).await.unwrap();
    let config = ConnectionConfig {
        id: "mongo".into(),
        name: "mongo".into(),
        engine: Engine::Mongo,
        environment: Environment::Local,
        read_only: false,
        timeout_secs: 30,
        target: Target::Network {
            host: "127.0.0.1".into(),
            port,
            database: "shop".into(),
            username: String::new(),
        },
        tls: TlsConfig {
            mode: TlsMode::Disable,
            ca_cert_path: None,
        },
        key_separator: None,
        ssh: None,
        group: None,
    };
    (container, config)
}

async fn connect(config: &ConnectionConfig) -> MongoAdapter {
    MongoAdapter::connect(config, None).await.unwrap()
}

fn find(filter: &str, sort: &str, projection: &str, page: u32, page_size: u32) -> FindRequest {
    FindRequest {
        database: "shop".into(),
        collection: "items".into(),
        filter: filter.into(),
        sort: sort.into(),
        projection: projection.into(),
        page,
        page_size,
    }
}

async fn seed(db: &MongoAdapter, count: i32) {
    for n in 1..=count {
        db.insert(
            "shop",
            "items",
            doc! { "_id": n, "n": n, "kind": if n % 2 == 0 { "even" } else { "odd" } },
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn documents_keep_their_types_through_the_database() {
    let (_container, config) = start().await;
    let db = connect(&config).await;
    let typed = r#"{"name":"Ana","small_long":{"$numberLong":"5"},"big_long":{"$numberLong":"9007199254740993"},"int":30,"double":1.0,"price":{"$numberDecimal":"19.90"},"created":{"$date":"2024-01-01T00:00:00Z"},"avatar":{"$binary":{"base64":"AP8=","subType":"00"}},"tags":["a",{"nested":{"$numberLong":"7"}}],"nothing":null}"#;

    let id = db
        .insert(
            "shop",
            "people",
            ejson::parse_document(typed, "documento").unwrap(),
        )
        .await
        .unwrap();
    assert!(id.starts_with(r#"{"$oid":""#), "{id}");

    let page = db
        .find(&FindRequest {
            collection: "people".into(),
            ..find("", "", "", 0, 10)
        })
        .await
        .unwrap();
    let stored = &page.documents[0];
    // the text the UI gets is the text it sent, plus the generated _id first
    assert_eq!(stored, &format!("{{\"_id\":{id},{}", &typed[1..]));

    // editing a field and saving back keeps every other type
    let edited = stored.replace(r#""name":"Ana""#, r#""name":"Ana Paula""#);
    db.replace(
        "shop",
        "people",
        ejson::parse_value(&id, "_id").unwrap(),
        ejson::parse_document(&edited, "documento").unwrap(),
    )
    .await
    .unwrap();
    let after = db
        .find(&FindRequest {
            collection: "people".into(),
            ..find("", "", "", 0, 10)
        })
        .await
        .unwrap();
    assert_eq!(after.documents[0], edited);
}

#[tokio::test]
async fn browse_write_and_introspect() {
    let (_container, config) = start().await;
    let db = connect(&config).await;
    seed(&db, 25).await;
    db.insert("other", "notes", doc! { "x": 1 }).await.unwrap();

    let first = db.find(&find("", "", "", 0, 10)).await.unwrap();
    assert_eq!((first.documents.len(), first.has_more), (10, true));
    let last = db.find(&find("", "", "", 2, 10)).await.unwrap();
    assert_eq!((last.documents.len(), last.has_more), (5, false));

    let filtered = db
        .find(&find(
            r#"{"kind": "even", "n": {"$gt": 10}}"#,
            r#"{"n": -1}"#,
            r#"{"kind": 0}"#,
            0,
            10,
        ))
        .await
        .unwrap();
    assert_eq!(filtered.documents.len(), 7);
    assert_eq!(filtered.documents[0], r#"{"_id":24,"n":24}"#);
    assert!(matches!(
        db.find(&find("{oops", "", "", 0, 10)).await,
        Err(AppError::Validation(_))
    ));

    db.replace(
        "shop",
        "items",
        ejson::parse_value("1", "_id").unwrap(),
        doc! { "n": 100 },
    )
    .await
    .unwrap();
    db.delete("shop", "items", ejson::parse_value("2", "_id").unwrap())
        .await
        .unwrap();
    let missing = || ejson::parse_value("999", "_id").unwrap();
    assert!(matches!(
        db.replace("shop", "items", missing(), doc! {}).await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        db.delete("shop", "items", missing()).await,
        Err(AppError::Conflict(_))
    ));

    db.client
        .database("shop")
        .run_command(doc! {
            "createIndexes": "items",
            "indexes": [{ "key": { "kind": 1, "n": -1 }, "name": "kind_n", "unique": true }],
        })
        .await
        .unwrap();
    db.client
        .database("shop")
        .run_command(doc! { "create": "evens", "viewOn": "items", "pipeline": [{ "$match": { "kind": "even" } }] })
        .await
        .unwrap();
    let indexes = db.indexes("shop", "items").await.unwrap();
    let definitions: Vec<_> = indexes
        .iter()
        .map(|i| (i.name.as_str(), i.definition.as_str()))
        .collect();
    assert!(definitions.contains(&("_id_", r#"{"_id":1}"#)));
    assert!(definitions.contains(&("kind_n", r#"{"kind":1,"n":-1} UNIQUE"#)));

    let schemas = db.list_schemas().await.unwrap();
    let names: Vec<_> = schemas.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["other", "shop"]);
    let shop: Vec<_> = schemas[1]
        .relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        shop,
        vec![
            ("evens", RelationKind::View),
            ("items", RelationKind::Table)
        ]
    );
}

#[tokio::test]
async fn aggregation_truncates_and_cancels() {
    let (_container, config) = start().await;
    let db = connect(&config).await;
    let many: Vec<Document> = (0..1500).map(|n| doc! { "n": n }).collect();
    db.client
        .database("shop")
        .collection::<Document>("big")
        .insert_many(many)
        .await
        .unwrap();
    seed(&db, 20).await;

    let pipeline = ejson::parse_pipeline(
        r#"[{"$group": {"_id": "$kind", "total": {"$sum": "$n"}}}, {"$sort": {"_id": 1}}]"#,
    )
    .unwrap();
    let (grouped, truncated) = db
        .aggregate("shop", "items", pipeline, "run-1")
        .await
        .unwrap();
    assert_eq!(
        grouped,
        vec![
            r#"{"_id":"even","total":110}"#,
            r#"{"_id":"odd","total":100}"#
        ]
    );
    assert!(!truncated);

    let (all, truncated) = db
        .aggregate("shop", "big", vec![doc! { "$match": {} }], "run-2")
        .await
        .unwrap();
    assert_eq!(all.len(), MAX_AGGREGATE_DOCUMENTS);
    assert!(truncated);

    // 20 documents × 200 ms of server-side sleep
    let slow = || {
        vec![doc! { "$addFields": { "slept": {
            "$function": { "body": "function() { sleep(200); return true; }", "args": [], "lang": "js" }
        } } }]
    };

    // cancel: the run id tags the operation so it can be found and killed
    let started = Instant::now();
    let running = db.aggregate("shop", "items", slow(), "run-3");
    let killer = async {
        tokio::time::sleep(Duration::from_millis(700)).await;
        db.kill("run-3").await.unwrap();
    };
    let (result, ()) = tokio::join!(running, killer);
    assert!(matches!(result, Err(AppError::Cancelled(_))), "{result:?}");
    assert!(started.elapsed() < Duration::from_secs(3));
    // timeouts are maxTimeMS, enforced by the server; the error mapping is unit-tested
    // (maxTimeMS does not interrupt a JS sleep, so this pipeline cannot exercise it)
}

#[tokio::test]
async fn connection_string_and_bad_hosts() {
    let (_container, config) = start().await;
    let Target::Network { port, .. } = config.target else {
        unreachable!()
    };

    let uri_config = ConnectionConfig {
        target: Target::Uri {
            database: String::new(),
        },
        ..config.clone()
    };
    let db = MongoAdapter::connect(
        &uri_config,
        Some(format!("mongodb://127.0.0.1:{port}/fromuri")),
    )
    .await
    .unwrap();
    db.insert("fromuri", "c", doc! { "a": 1 }).await.unwrap();
    // the URI's database is the default one
    assert_eq!(db.default_database.as_deref(), Some("fromuri"));

    let mut unreachable = config;
    unreachable.target = Target::Network {
        host: "127.0.0.1".into(),
        port: 1,
        database: String::new(),
        username: String::new(),
    };
    let started = Instant::now();
    let err = MongoAdapter::connect(&unreachable, None)
        .await
        .err()
        .unwrap();
    assert!(matches!(err, AppError::Database(_)));
    assert!(!err.to_string().contains("Topology"), "{err}");
    assert!(started.elapsed() < Duration::from_secs(15));
}
