//! Runs against a real Redis in Docker (testcontainers). One container per test.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

use super::{MAX_ELEMENTS, RedisAdapter};
use crate::domain::{
    AppError, ConnectionConfig, Engine, Environment, RedisText, RedisValue, Target, TlsConfig,
    TlsMode,
};

pub(crate) async fn start() -> (ContainerAsync<Redis>, ConnectionConfig) {
    // KEEPTTL needs Redis 6+; the module defaults to 5.0
    let container = Redis::default()
        .with_tag("7.4-alpine")
        .start()
        .await
        .expect("docker is required for integration tests");
    let port = container.get_host_port_ipv4(6379).await.unwrap();
    let config = ConnectionConfig {
        id: "redis".into(),
        name: "redis".into(),
        engine: Engine::Redis,
        environment: Environment::Local,
        read_only: false,
        timeout_secs: 30,
        target: Target::Network {
            host: "127.0.0.1".into(),
            port,
            database: "0".into(),
            username: String::new(),
        },
        tls: TlsConfig {
            mode: TlsMode::Disable,
            ca_cert_path: None,
        },
        key_separator: Some(":".into()),
        ssh: None,
        group: None,
    };
    (container, config)
}

pub(crate) async fn run(redis: &RedisAdapter, db: u8, line: &str) -> String {
    let args = super::reply::split_args(line).unwrap();
    redis.command(db, &args).await.unwrap()
}

fn text(value: &str) -> RedisText {
    RedisText {
        text: value.into(),
        binary: false,
    }
}

#[tokio::test]
async fn every_type_is_read_with_ttl_and_length() {
    let (_container, config) = start().await;
    let redis = RedisAdapter::connect(&config, None).await.unwrap();
    for line in [
        "SET greeting \"olá\" EX 100",
        "SET blob \"\\xff\\x00\"",
        "HSET user:1 name Ana city \"São Paulo\"",
        "RPUSH queue b a b",
        "SADD tags red blue",
        "ZADD ranking 2 bob 1.5 ana +inf top",
        "XADD events 1-1 kind login user ana",
    ] {
        run(&redis, 0, line).await;
    }

    let greeting = redis.read_key(0, "greeting").await.unwrap();
    assert_eq!(
        greeting.value,
        RedisValue::String {
            value: text("olá")
        }
    );
    assert_eq!(greeting.length, 4, "bytes, not characters");
    assert!(greeting.ttl_secs.is_some_and(|ttl| ttl > 90 && ttl <= 100));

    let blob = redis.read_key(0, "blob").await.unwrap();
    assert_eq!(
        blob.value,
        RedisValue::String {
            value: RedisText {
                text: r"\xff\x00".into(),
                binary: true
            }
        }
    );
    assert_eq!(blob.ttl_secs, None);

    let RedisValue::Hash { entries } = redis.read_key(0, "user:1").await.unwrap().value else {
        panic!("hash expected");
    };
    let fields: Vec<_> = entries
        .iter()
        .map(|e| (e.field.text.as_str(), e.value.text.as_str()))
        .collect();
    assert_eq!(fields, [("city", "São Paulo"), ("name", "Ana")]);

    assert_eq!(
        redis.read_key(0, "queue").await.unwrap().value,
        RedisValue::List {
            items: vec![text("b"), text("a"), text("b")]
        }
    );
    assert_eq!(
        redis.read_key(0, "tags").await.unwrap().value,
        RedisValue::Set {
            members: vec![text("blue"), text("red")]
        }
    );

    let RedisValue::Zset { entries } = redis.read_key(0, "ranking").await.unwrap().value else {
        panic!("zset expected");
    };
    let scores: Vec<_> = entries
        .iter()
        .map(|e| (e.member.text.as_str(), e.score.as_str()))
        .collect();
    assert_eq!(scores, [("ana", "1.5"), ("bob", "2"), ("top", "inf")]);

    let RedisValue::Stream { entries } = redis.read_key(0, "events").await.unwrap().value else {
        panic!("stream expected");
    };
    assert_eq!(entries[0].id, "1-1");
    assert_eq!(entries[0].fields[1].value, text("ana"));

    assert!(matches!(
        redis.read_key(0, "missing").await,
        Err(AppError::NotFound(_))
    ));
}

#[tokio::test]
async fn big_collections_are_truncated() {
    let (_container, config) = start().await;
    let redis = RedisAdapter::connect(&config, None).await.unwrap();
    let count = MAX_ELEMENTS + 5;
    let members: Vec<String> = (0..count).map(|i| format!("m{i}")).collect();
    let mut sadd = vec!["SADD".to_string(), "big:set".to_string()];
    sadd.extend(members.iter().cloned());
    let mut hset = vec!["HSET".to_string(), "big:hash".to_string()];
    hset.extend(members.iter().flat_map(|m| [m.clone(), "v".to_string()]));
    let mut rpush = vec!["RPUSH".to_string(), "big:list".to_string()];
    rpush.extend(members.iter().cloned());
    redis.atomic(0, &[sadd, hset, rpush]).await.unwrap();

    for key in ["big:set", "big:hash", "big:list"] {
        let detail = redis.read_key(0, key).await.unwrap();
        let loaded = match &detail.value {
            RedisValue::Set { members } => members.len(),
            RedisValue::Hash { entries } => entries.len(),
            RedisValue::List { items } => items.len(),
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(loaded, MAX_ELEMENTS, "{key}");
        assert_eq!(detail.length as usize, count, "{key}");
        assert!(detail.truncated, "{key}");
    }
}

#[tokio::test]
async fn scan_pages_through_every_key_and_counts_databases() {
    let (_container, config) = start().await;
    let redis = RedisAdapter::connect(&config, None).await.unwrap();
    let mut mset = vec!["MSET".to_string()];
    for i in 0..2500 {
        mset.extend([format!("user:{i}"), "x".to_string()]);
    }
    mset.extend(["order:1".to_string(), "x".to_string()]);
    redis.atomic(0, &[mset]).await.unwrap();
    run(&redis, 3, "SET only:in:three 1").await;

    let mut seen = HashSet::new();
    let mut cursor = "0".to_string();
    let mut pages = 0;
    loop {
        let page = redis.scan(0, "user:*", &cursor).await.unwrap();
        assert!(page.keys.iter().all(|key| key.kind == "string"));
        seen.extend(page.keys.into_iter().map(|key| key.name));
        pages += 1;
        cursor = page.cursor;
        if cursor == "0" {
            break;
        }
    }
    assert_eq!(seen.len(), 2500);
    assert!(!seen.contains("order:1"));
    assert!(pages > 1, "a page stops near SCAN_TARGET keys");

    let databases = redis.databases().await.unwrap();
    assert_eq!(databases.len(), 16);
    assert_eq!(databases[0].keys, 2501);
    assert_eq!(databases[3].keys, 1);
    assert_eq!(databases[1].keys, 0);
}

#[tokio::test]
async fn console_replies_info_and_timeout() {
    let (_container, mut config) = start().await;
    config.timeout_secs = 1;
    let redis = RedisAdapter::connect(&config, None).await.unwrap();

    assert_eq!(run(&redis, 0, "SET k v").await, "OK");
    assert_eq!(run(&redis, 0, "RPUSH l a b").await, "(integer) 2");
    assert_eq!(run(&redis, 0, "LRANGE l 0 -1").await, "1) \"a\"\n2) \"b\"");
    assert_eq!(run(&redis, 0, "GET missing").await, "(nil)");
    assert!(
        run(&redis, 0, "INFO server")
            .await
            .starts_with("# Server\n")
    );

    let err = redis.command(0, &[b"NOPE".to_vec()]).await.unwrap_err();
    assert!(
        matches!(&err, AppError::Database(message) if message.contains("unknown command")),
        "{err:?}"
    );

    let info = redis.info(None).await.unwrap();
    assert!(info.iter().any(|section| section.name == "Memory"));

    // a blocking command outlives the 1 s response timeout
    let started = Instant::now();
    let err = redis
        .command(0, &[b"BLPOP".to_vec(), b"empty".to_vec(), b"5".to_vec()])
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Timeout(_)), "{err:?}");
    assert!(started.elapsed() < Duration::from_secs(3));
    // the connection is still usable afterwards
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(run(&redis, 0, "GET k").await, "\"v\"");
}

#[tokio::test]
async fn wrong_password_fails_on_connect() {
    let (_container, config) = start().await;
    let redis = RedisAdapter::connect(&config, None).await.unwrap();
    run(&redis, 0, "CONFIG SET requirepass s3cret").await;

    let err = RedisAdapter::connect(&config, None)
        .await
        .err()
        .expect("NOAUTH");
    assert!(matches!(&err, AppError::Database(m) if m.contains("falha ao conectar")));
    assert!(
        RedisAdapter::connect(&config, Some("s3cret".into()))
            .await
            .is_ok()
    );
}
