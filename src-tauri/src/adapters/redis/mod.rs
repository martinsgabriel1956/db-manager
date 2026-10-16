pub mod reply;

#[cfg(test)]
pub(crate) mod integration_tests;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::future::try_join_all;
use redis::aio::{ConnectionLike, MultiplexedConnection};
use redis::cluster::ClusterClientBuilder;
use redis::cluster_async::ClusterConnection;
use redis::cluster_routing::{RoutingInfo, SingleNodeRoutingInfo};
use redis::sentinel::{SentinelClient, SentinelClientBuilder, SentinelServerType};
use redis::{
    AsyncConnectionConfig, Client, Cmd, ConnectionAddr, ConnectionInfo, FromRedisValue,
    IntoConnectionInfo, Pipeline, RedisConnectionInfo, RedisError, RedisFuture, TlsCertificates,
    Value,
};
use tokio::sync::oneshot;

use crate::domain::{
    AppError, ConnectionConfig, HashEntry, InfoSection, KeyDetail, KeyEntry, KeyPage, NodeAddress,
    PubSubEvent, RedisDatabase, RedisValue, StreamEntry, Target, TlsMode, ZsetEntry,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Elements of a collection loaded for viewing; more is reported as truncated.
pub const MAX_ELEMENTS: usize = 1000;
/// Bytes of a string loaded for viewing.
pub const MAX_STRING_BYTES: usize = 1024 * 1024;
/// A key page stops once it has this many keys…
const SCAN_TARGET: usize = 1000;
/// …or after this many SCAN calls, so a sparse MATCH does not walk the whole keyspace.
const SCAN_ROUNDS: usize = 10;
const SCAN_COUNT: usize = 1000;
const DEFAULT_DATABASES: u8 = 16;

pub struct RedisAdapter {
    server: Server,
    default_db: u8,
    timeout_secs: u32,
    /// live sessions on dedicated connections (pub/sub), by id; dropping the
    /// sender ends the session
    streams: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

enum Server {
    /// One multiplexed connection per logical database, opened on first use.
    Standalone {
        // the std locks are never held across an await
        info: Mutex<ConnectionInfo>,
        config: AsyncConnectionConfig,
        connections: Mutex<HashMap<u8, MultiplexedConnection>>,
        /// Behind Sentinel: asked for the master again whenever a connection is
        /// opened, so reconnecting after a failover reaches the new master.
        sentinel: Option<tokio::sync::Mutex<SentinelClient>>,
    },
    /// Routes each command to the node that owns its key, and reconnects by itself.
    /// A cluster only has database 0. `seed` is the first seed node, where dedicated
    /// connections (pub/sub) go: a PUBLISH reaches every node of the cluster.
    Cluster {
        connection: ClusterConnection,
        seed: ConnectionInfo,
    },
}

impl Server {
    fn standalone(
        info: ConnectionInfo,
        timeout: Option<Duration>,
        sentinel: Option<SentinelClient>,
    ) -> Self {
        Server::Standalone {
            info: Mutex::new(info),
            config: AsyncConnectionConfig::new()
                .set_connection_timeout(Some(CONNECT_TIMEOUT))
                .set_response_timeout(timeout),
            connections: Mutex::new(HashMap::new()),
            sentinel: sentinel.map(tokio::sync::Mutex::new),
        }
    }
}

/// Either kind of connection, so commands and pipelines run the same way on both.
#[derive(Clone)]
enum Connection {
    Single(MultiplexedConnection),
    Cluster(ClusterConnection),
}

impl ConnectionLike for Connection {
    fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, Value> {
        match self {
            Self::Single(connection) => connection.req_packed_command(cmd),
            Self::Cluster(connection) => connection.req_packed_command(cmd),
        }
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipeline: &'a Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<Value>> {
        match self {
            Self::Single(connection) => connection.req_packed_commands(pipeline, offset, count),
            Self::Cluster(connection) => connection.req_packed_commands(pipeline, offset, count),
        }
    }

    fn get_db(&self) -> i64 {
        match self {
            Self::Single(connection) => connection.get_db(),
            Self::Cluster(connection) => connection.get_db(),
        }
    }
}

impl RedisAdapter {
    /// `sentinel_password` authenticates to the sentinels; `password` always to Redis.
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<String>,
        sentinel_password: Option<String>,
    ) -> Result<Self, AppError> {
        let password = password.filter(|p| !p.is_empty());
        let timeout =
            (config.timeout_secs > 0).then(|| Duration::from_secs(u64::from(config.timeout_secs)));
        let failed = |err: RedisError| AppError::Database(format!("falha ao conectar: {err}"));

        let (server, default_db) = match &config.target {
            Target::Network {
                host,
                port,
                database,
                username,
            } => {
                let info = connection_info(config, host, *port)?
                    .set_redis_settings(settings(username, password.as_deref()));
                (Server::standalone(info, timeout, None), parse_db(database)?)
            }
            Target::RedisSentinel {
                nodes,
                master_name,
                database,
                username,
            } => {
                let sentinels = nodes
                    .iter()
                    .map(|node| address(config.tls.mode, &node.host, node.port));
                let mut builder =
                    SentinelClientBuilder::new(sentinels, master_name, SentinelServerType::Master)
                        .map_err(invalid_config)?;
                // the sentinels' addresses already say TLS or not; the master is told here
                match config.tls.mode {
                    TlsMode::Disable | TlsMode::Prefer => {}
                    TlsMode::Require => {
                        builder = builder.set_client_to_redis_tls_mode(redis::TlsMode::Insecure);
                    }
                    TlsMode::VerifyFull => {
                        builder = builder.set_client_to_redis_tls_mode(redis::TlsMode::Secure);
                    }
                }
                if let Some(certificates) = certificates(config)? {
                    builder = builder
                        .set_client_to_redis_certificates(certificates.clone())
                        .set_client_to_sentinel_certificates(certificates);
                }
                if !username.is_empty() {
                    builder = builder.set_client_to_redis_username(username);
                }
                if let Some(password) = password {
                    builder = builder.set_client_to_redis_password(password);
                }
                if let Some(password) = sentinel_password.filter(|p| !p.is_empty()) {
                    builder = builder.set_client_to_sentinel_password(password);
                }
                let mut sentinel = builder.build().map_err(invalid_config)?;
                let master = sentinel.async_get_client().await.map_err(failed)?;
                let info = master.get_connection_info().clone();
                (
                    Server::standalone(info, timeout, Some(sentinel)),
                    parse_db(database)?,
                )
            }
            Target::RedisCluster { nodes, username } => {
                let seed = match nodes.first() {
                    Some(node) => connection_info(config, &node.host, node.port)?
                        .set_redis_settings(settings(username, password.as_deref())),
                    None => return Err(AppError::validation("informe ao menos um nó do cluster")),
                };
                let mut builder = ClusterClientBuilder::new(
                    nodes
                        .iter()
                        .map(|node| address(config.tls.mode, &node.host, node.port)),
                )
                .connection_timeout(CONNECT_TIMEOUT);
                if let Some(certificates) = certificates(config)? {
                    builder = builder.certs(certificates);
                }
                if !username.is_empty() {
                    builder = builder.username(username);
                }
                if let Some(password) = password {
                    builder = builder.password(password);
                }
                if let Some(timeout) = timeout {
                    builder = builder.response_timeout(timeout);
                }
                let client = builder.build().map_err(invalid_config)?;
                let connection = client.get_async_connection().await.map_err(failed)?;
                (Server::Cluster { connection, seed }, 0)
            }
            _ => return Err(AppError::validation("Redis precisa de host e porta")),
        };

        let adapter = Self {
            server,
            default_db,
            timeout_secs: config.timeout_secs,
            streams: Mutex::new(HashMap::new()),
        };
        // the handshake authenticates; PING catches servers that require a password we lack
        adapter
            .query::<String>(default_db, &redis::cmd("PING"))
            .await
            .map_err(|err| AppError::Database(format!("falha ao conectar: {err}")))?;
        Ok(adapter)
    }

    pub fn close(&self) {
        if let Server::Standalone { connections, .. } = &self.server {
            lock(connections).clear();
        }
        lock(&self.streams).clear();
    }

    /// Subscribes on a dedicated connection (one in subscribe mode runs nothing
    /// else) and forwards each message to `send` until `stop(id)`, `close`, the
    /// server closing it, or `send` returning false (the panel is gone).
    pub async fn subscribe(
        &self,
        id: &str,
        channels: &[String],
        patterns: &[String],
        send: impl Fn(PubSubEvent) -> bool + Send + 'static,
    ) -> Result<(), AppError> {
        let info = match &self.server {
            Server::Standalone { info, .. } => lock(info).clone(),
            Server::Cluster { seed, .. } => seed.clone(),
        };
        let client = Client::open(info).map_err(|err| self.error(err))?;
        let mut pubsub = tokio::time::timeout(CONNECT_TIMEOUT, client.get_async_pubsub())
            .await
            .map_err(|_| AppError::Timeout("falha ao conectar: tempo esgotado".into()))?
            .map_err(|err| self.error(err))?;
        if !channels.is_empty() {
            pubsub
                .subscribe(channels)
                .await
                .map_err(|err| self.error(err))?;
        }
        if !patterns.is_empty() {
            pubsub
                .psubscribe(patterns)
                .await
                .map_err(|err| self.error(err))?;
        }
        let (stop, mut stopped) = oneshot::channel();
        lock(&self.streams).insert(id.to_string(), stop);
        tokio::spawn(async move {
            let mut messages = pubsub.into_on_message();
            let reason = loop {
                tokio::select! {
                    _ = &mut stopped => break "assinatura encerrada",
                    message = messages.next() => match message {
                        Some(message) => {
                            if !send(pubsub_event(&message)) {
                                return;
                            }
                        }
                        None => break "o servidor encerrou a conexão",
                    },
                }
            };
            send(PubSubEvent::Ended {
                reason: reason.to_string(),
            });
        });
        Ok(())
    }

    /// Ends a live session; unknown ids (already ended) are ignored.
    pub fn stop(&self, id: &str) {
        lock(&self.streams).remove(id);
    }

    async fn connection(&self, db: u8) -> Result<Connection, AppError> {
        let (info, config, connections, sentinel) = match &self.server {
            Server::Cluster { .. } if db != 0 => {
                return Err(AppError::validation("um cluster só tem o database 0"));
            }
            Server::Cluster { connection, .. } => {
                return Ok(Connection::Cluster(connection.clone()));
            }
            Server::Standalone {
                info,
                config,
                connections,
                sentinel,
            } => (info, config, connections, sentinel),
        };
        if let Some(connection) = lock(connections).get(&db) {
            return Ok(Connection::Single(connection.clone()));
        }
        if let Some(sentinel) = sentinel {
            let master = sentinel
                .lock()
                .await
                .async_get_client()
                .await
                .map_err(|err| self.error(err))?;
            *lock(info) = master.get_connection_info().clone();
        }
        let info = lock(info).clone();
        let settings = info.redis_settings().clone().set_db(i64::from(db));
        let client =
            Client::open(info.set_redis_settings(settings)).map_err(|err| self.error(err))?;
        let connection = client
            .get_multiplexed_async_connection_with_config(config)
            .await
            .map_err(|err| self.error(err))?;
        lock(connections).insert(db, connection.clone());
        Ok(Connection::Single(connection))
    }

    /// The master the sentinels pointed to on the last (re)connect; None without Sentinel.
    pub fn master(&self) -> Option<String> {
        match &self.server {
            Server::Standalone {
                info,
                sentinel: Some(_),
                ..
            } => Some(lock(info).addr().to_string()),
            _ => None,
        }
    }

    /// A broken standalone connection is dropped so the next call opens a new one.
    fn fail(&self, db: u8, err: RedisError) -> AppError {
        if let Server::Standalone { connections, .. } = &self.server
            && err.is_unrecoverable_error()
        {
            lock(connections).remove(&db);
        }
        self.error(err)
    }

    fn error(&self, err: RedisError) -> AppError {
        map_error(&err, self.timeout_secs)
    }

    async fn query<T: FromRedisValue>(&self, db: u8, command: &Cmd) -> Result<T, AppError> {
        let mut connection = self.connection(db).await?;
        command
            .query_async(&mut connection)
            .await
            .map_err(|err| self.fail(db, err))
    }

    /// `command` on one cluster node; routed as usual without a node.
    async fn query_on<T: FromRedisValue>(
        &self,
        db: u8,
        node: Option<&NodeAddress>,
        command: &Cmd,
    ) -> Result<T, AppError> {
        let (Some(node), Server::Cluster { connection, .. }) = (node, &self.server) else {
            return self.query(db, command).await;
        };
        let routing = RoutingInfo::SingleNode(SingleNodeRoutingInfo::ByAddress {
            host: node.host.clone(),
            port: node.port,
        });
        let value = connection
            .clone()
            .route_command(command.clone(), routing)
            .await
            .map_err(|err| self.error(err))?;
        redis::from_redis_value(value).map_err(|err| self.error(err.into()))
    }

    /// The cluster's primaries as it announces them (CLUSTER SLOTS), sorted so that a
    /// node index in a SCAN cursor means the same node on the next page. Empty when
    /// standalone.
    async fn primaries(&self) -> Result<Vec<NodeAddress>, AppError> {
        if let Server::Standalone { .. } = self.server {
            return Ok(Vec::new());
        }
        // [start, end, [host, port, id, …] (the primary), replicas…]
        let ranges: Vec<Vec<Value>> = self.query(0, redis::cmd("CLUSTER").arg("SLOTS")).await?;
        let mut primaries: Vec<NodeAddress> = ranges
            .into_iter()
            .filter_map(|range| {
                let node: Vec<Value> = redis::from_redis_value(range.get(2)?.clone()).ok()?;
                Some(NodeAddress {
                    host: redis::from_redis_value(node.first()?.clone()).ok()?,
                    port: redis::from_redis_value(node.get(1)?.clone()).ok()?,
                })
            })
            .collect();
        primaries.sort_by(|a, b| (&a.host, a.port).cmp(&(&b.host, b.port)));
        primaries.dedup();
        Ok(primaries)
    }

    /// Databases 0..N (CONFIG GET databases; 16 when CONFIG is not allowed) with
    /// their key counts from INFO keyspace. A cluster has only database 0.
    pub async fn databases(&self) -> Result<Vec<RedisDatabase>, AppError> {
        if let Server::Cluster { .. } = self.server {
            // summed over the primaries by the cluster client
            let keys: u64 = self.query(0, &redis::cmd("DBSIZE")).await?;
            return Ok(vec![RedisDatabase {
                index: 0,
                keys: u32::try_from(keys).unwrap_or(u32::MAX),
            }]);
        }
        let configured = self
            .query::<Vec<String>>(
                self.default_db,
                redis::cmd("CONFIG").arg("GET").arg("databases"),
            )
            .await
            .ok()
            .and_then(|reply| reply.get(1)?.parse::<u8>().ok())
            .unwrap_or(DEFAULT_DATABASES);
        let count = configured.max(self.default_db.saturating_add(1));

        let keyspace = self.info(Some("keyspace")).await?;
        let keys: HashMap<String, u32> = keyspace
            .iter()
            .flat_map(|section| &section.entries)
            .map(|(name, stats)| (name.clone(), keys_in(stats)))
            .collect();
        Ok((0..count)
            .map(|index| RedisDatabase {
                index,
                keys: keys.get(&format!("db{index}")).copied().unwrap_or(0),
            })
            .collect())
    }

    /// One page of SCAN MATCH `pattern`, continuing from `cursor` ("0" starts over),
    /// with each key's TYPE. Never KEYS: it blocks the server on large databases.
    /// A cluster is scanned one primary after the other, with the cursor as
    /// "<primary index>:<that primary's cursor>".
    // ponytail: names that are not UTF-8 are shown lossily and cannot be opened
    pub async fn scan(&self, db: u8, pattern: &str, cursor: &str) -> Result<KeyPage, AppError> {
        let primaries = self.primaries().await?;
        let (mut node, mut cursor) = match cursor.split_once(':') {
            Some((node, cursor)) => (
                node.parse::<usize>()
                    .map_err(|_| AppError::validation("cursor de SCAN inválido"))?,
                cursor.to_string(),
            ),
            None => (0, cursor.to_string()),
        };
        let mut keys = Vec::new();
        let mut done = false;
        for _ in 0..SCAN_ROUNDS {
            let target = if primaries.is_empty() {
                None
            } else {
                Some(primaries.get(node).ok_or_else(|| {
                    AppError::validation("o cluster mudou durante a busca: recarregue as chaves")
                })?)
            };
            let (next, names): (String, Vec<Vec<u8>>) = self
                .query_on(
                    db,
                    target,
                    redis::cmd("SCAN")
                        .arg(&cursor)
                        .arg("MATCH")
                        .arg(pattern)
                        .arg("COUNT")
                        .arg(SCAN_COUNT),
                )
                .await?;
            // one TYPE per key, concurrent on the multiplexed connection: in a
            // cluster each goes to its key's node, which a pipeline cannot do
            let kinds: Vec<String> = try_join_all(
                names
                    .iter()
                    .map(|name| async move { self.query(db, redis::cmd("TYPE").arg(name)).await }),
            )
            .await?;
            keys.extend(
                names
                    .into_iter()
                    .zip(kinds)
                    // deleted between SCAN and TYPE
                    .filter(|(_, kind)| kind != "none")
                    .map(|(name, kind)| KeyEntry {
                        name: String::from_utf8_lossy(&name).into_owned(),
                        kind,
                    }),
            );
            cursor = next;
            if cursor == "0" {
                node += 1;
                if node >= primaries.len() {
                    done = true;
                    break;
                }
            }
            if keys.len() >= SCAN_TARGET {
                break;
            }
        }
        let cursor = match (done, primaries.is_empty()) {
            (true, _) => "0".to_string(),
            (false, true) => cursor,
            (false, false) => format!("{node}:{cursor}"),
        };
        Ok(KeyPage { keys, cursor })
    }

    /// The key's type, TTL and value (the first `MAX_ELEMENTS` of a collection).
    pub async fn read_key(&self, db: u8, key: &str) -> Result<KeyDetail, AppError> {
        let mut connection = self.connection(db).await?;
        let (kind, ttl): (String, i64) = redis::pipe()
            .cmd("TYPE")
            .arg(key)
            .cmd("TTL")
            .arg(key)
            .query_async(&mut connection)
            .await
            .map_err(|err| self.fail(db, err))?;
        let ttl_secs = u64::try_from(ttl)
            .ok()
            .map(|ttl| u32::try_from(ttl).unwrap_or(u32::MAX));
        let length_of = |command: &'static str| self.length(db, command, key);
        let max = MAX_ELEMENTS as isize;

        let (length, value) = match kind.as_str() {
            "none" => return Err(AppError::not_found(&format!("chave {key}"))),
            "string" => {
                let length = length_of("STRLEN").await?;
                let bytes: Vec<u8> = self
                    .query(
                        db,
                        redis::cmd("GETRANGE")
                            .arg(key)
                            .arg(0)
                            .arg(MAX_STRING_BYTES - 1),
                    )
                    .await?;
                let value = RedisValue::String {
                    value: reply::text(&bytes),
                };
                return Ok(KeyDetail {
                    key: key.to_string(),
                    ttl_secs,
                    length,
                    value,
                    truncated: length as usize > MAX_STRING_BYTES,
                });
            }
            "hash" => {
                let items = self.scan_collection(db, "HSCAN", key, 2).await?;
                let fields: BTreeMap<Vec<u8>, Vec<u8>> = pairs(items).collect();
                let entries = fields
                    .iter()
                    .map(|(field, value)| HashEntry {
                        field: reply::text(field),
                        value: reply::text(value),
                    })
                    .collect();
                (length_of("HLEN").await?, RedisValue::Hash { entries })
            }
            "list" => {
                let items: Vec<Vec<u8>> = self
                    .query(db, redis::cmd("LRANGE").arg(key).arg(0).arg(max - 1))
                    .await?;
                let items = items.iter().map(|item| reply::text(item)).collect();
                (length_of("LLEN").await?, RedisValue::List { items })
            }
            "set" => {
                let items = self.scan_collection(db, "SSCAN", key, 1).await?;
                let members: BTreeSet<Vec<u8>> = items.into_iter().collect();
                let members = members.iter().map(|member| reply::text(member)).collect();
                (length_of("SCARD").await?, RedisValue::Set { members })
            }
            "zset" => {
                let items: Vec<Vec<u8>> = self
                    .query(
                        db,
                        redis::cmd("ZRANGE")
                            .arg(key)
                            .arg(0)
                            .arg(max - 1)
                            .arg("WITHSCORES"),
                    )
                    .await?;
                let entries = pairs(items)
                    .map(|(member, score)| ZsetEntry {
                        member: reply::text(&member),
                        score: String::from_utf8_lossy(&score).into_owned(),
                    })
                    .collect();
                (length_of("ZCARD").await?, RedisValue::Zset { entries })
            }
            "stream" => {
                let raw: Vec<(String, Vec<Vec<u8>>)> = self
                    .query(
                        db,
                        redis::cmd("XRANGE")
                            .arg(key)
                            .arg("-")
                            .arg("+")
                            .arg("COUNT")
                            .arg(MAX_ELEMENTS),
                    )
                    .await?;
                let entries = raw
                    .into_iter()
                    .map(|(id, fields)| StreamEntry {
                        id,
                        fields: pairs(fields)
                            .map(|(field, value)| HashEntry {
                                field: reply::text(&field),
                                value: reply::text(&value),
                            })
                            .collect(),
                    })
                    .collect();
                (length_of("XLEN").await?, RedisValue::Stream { entries })
            }
            other => (
                0,
                RedisValue::Unsupported {
                    type_name: other.to_string(),
                },
            ),
        };
        Ok(KeyDetail {
            key: key.to_string(),
            ttl_secs,
            length,
            value,
            truncated: length as usize > MAX_ELEMENTS,
        })
    }

    async fn length(&self, db: u8, command: &str, key: &str) -> Result<u32, AppError> {
        let length: u64 = self.query(db, redis::cmd(command).arg(key)).await?;
        Ok(u32::try_from(length).unwrap_or(u32::MAX))
    }

    /// HSCAN/SSCAN until `MAX_ELEMENTS` (each `width` items: field+value = 2) or the end.
    async fn scan_collection(
        &self,
        db: u8,
        command: &str,
        key: &str,
        width: usize,
    ) -> Result<Vec<Vec<u8>>, AppError> {
        let mut cursor = "0".to_string();
        let mut items = Vec::new();
        loop {
            let (next, batch): (String, Vec<Vec<u8>>) = self
                .query(
                    db,
                    redis::cmd(command)
                        .arg(key)
                        .arg(&cursor)
                        .arg("COUNT")
                        .arg(SCAN_COUNT),
                )
                .await?;
            items.extend(batch);
            cursor = next;
            if cursor == "0" || items.len() >= MAX_ELEMENTS * width {
                items.truncate(MAX_ELEMENTS * width);
                return Ok(items);
            }
        }
    }

    pub async fn exists(&self, db: u8, key: &str) -> Result<bool, AppError> {
        self.query(db, redis::cmd("EXISTS").arg(key)).await
    }

    /// Runs the commands in one MULTI/EXEC and returns each reply. A command that
    /// fails inside EXEC is an error, though the others were applied: Redis has no
    /// rollback.
    pub async fn atomic(&self, db: u8, commands: &[Vec<String>]) -> Result<Vec<Value>, AppError> {
        let mut pipe = redis::pipe();
        pipe.atomic();
        for args in commands {
            pipe.add_command(command_of(args));
        }
        let mut connection = self.connection(db).await?;
        pipe.query_async(&mut connection)
            .await
            .map_err(|err| self.fail(db, err))
    }

    /// One console command; the reply formatted like redis-cli.
    pub async fn command(&self, db: u8, args: &[Vec<u8>]) -> Result<String, AppError> {
        let mut command = redis::cmd(&String::from_utf8_lossy(&args[0]));
        for arg in &args[1..] {
            command.arg(arg);
        }
        let value: Value = self.query(db, &command).await?;
        Ok(reply::format_reply(&value))
    }

    /// INFO (or one section of it), parsed into sections.
    pub async fn info(&self, section: Option<&str>) -> Result<Vec<InfoSection>, AppError> {
        let mut command = redis::cmd("INFO");
        if let Some(section) = section {
            command.arg(section);
        }
        // each cluster node answers for itself: the first primary's, and it says so
        let primaries = self.primaries().await?;
        let text: String = self
            .query_on(self.default_db, primaries.first(), &command)
            .await?;
        let mut sections = parse_info(&text);
        if let Some(node) = primaries.first() {
            sections.insert(
                0,
                InfoSection {
                    name: "Cluster".to_string(),
                    entries: vec![
                        (
                            "nó exibido".to_string(),
                            format!("{}:{}", node.host, node.port),
                        ),
                        ("primários".to_string(), primaries.len().to_string()),
                    ],
                },
            );
        }
        Ok(sections)
    }
}

fn parse_db(database: &str) -> Result<u8, AppError> {
    if database.is_empty() {
        return Ok(0);
    }
    database
        .parse()
        .map_err(|_| AppError::validation("database do Redis deve ser um número"))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn command_of(args: &[String]) -> Cmd {
    let mut command = redis::cmd(&args[0]);
    for arg in &args[1..] {
        command.arg(arg);
    }
    command
}

fn pubsub_event(message: &redis::Msg) -> PubSubEvent {
    let bytes = |value: redis::RedisResult<Vec<u8>>| reply::text(&value.unwrap_or_default());
    PubSubEvent::Message {
        channel: bytes(message.get_channel()),
        pattern: message.from_pattern().then(|| bytes(message.get_pattern())),
        payload: reply::text(message.get_payload_bytes()),
    }
}

fn settings(username: &str, password: Option<&str>) -> RedisConnectionInfo {
    let mut settings = RedisConnectionInfo::default();
    if !username.is_empty() {
        settings = settings.set_username(username);
    }
    if let Some(password) = password {
        settings = settings.set_password(password);
    }
    settings
}

fn pairs(items: Vec<Vec<u8>>) -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    let mut items = items.into_iter();
    std::iter::from_fn(move || Some((items.next()?, items.next()?)))
}

/// Redis has no opportunistic TLS: "prefer" connects in plain text. "require"
/// encrypts without checking the certificate, "verifyFull" checks it (system roots
/// or the configured CA).
fn address(mode: TlsMode, host: &str, port: u16) -> ConnectionAddr {
    let tls = |insecure| ConnectionAddr::TcpTls {
        host: host.to_string(),
        port,
        insecure,
        tls_params: None,
    };
    match mode {
        TlsMode::Disable | TlsMode::Prefer => ConnectionAddr::Tcp(host.to_string(), port),
        TlsMode::Require => tls(true),
        TlsMode::VerifyFull => tls(false),
    }
}

/// The configured CA for "verifyFull"; None uses the system roots.
fn certificates(config: &ConnectionConfig) -> Result<Option<TlsCertificates>, AppError> {
    let (TlsMode::VerifyFull, Some(path)) = (config.tls.mode, &config.tls.ca_cert_path) else {
        return Ok(None);
    };
    let root_cert = std::fs::read(path)
        .map_err(|err| AppError::validation(format!("não foi possível ler o CA {path}: {err}")))?;
    Ok(Some(TlsCertificates {
        client_tls: None,
        root_cert: Some(root_cert),
    }))
}

fn connection_info(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<ConnectionInfo, AppError> {
    let address = address(config.tls.mode, host, port);
    match certificates(config)? {
        None => address.into_connection_info().map_err(invalid_config),
        Some(certificates) => Client::build_with_tls(address, certificates)
            .map(|client| client.get_connection_info().clone())
            .map_err(invalid_config),
    }
}

fn invalid_config(err: RedisError) -> AppError {
    AppError::validation(format!("configuração inválida: {err}"))
}

fn map_error(err: &RedisError, timeout_secs: u32) -> AppError {
    if err.is_timeout() {
        // nothing to cancel: Redis has no KILL for a running command
        return AppError::Timeout(format!(
            "comando excedeu o timeout de {timeout_secs}s (o Redis pode continuar executando-o)"
        ));
    }
    // alone, or inside a MULTI/EXEC that the server aborted
    let cross_slot = err.code() == Some("CROSSSLOT")
        || err
            .clone()
            .into_server_errors()
            .is_some_and(|errors| errors.iter().any(|(_, error)| error.code() == "CROSSSLOT"));
    if cross_slot {
        return AppError::Database(format!(
            "as chaves estão em slots diferentes do cluster; um comando com várias chaves só \
             roda quando todas caem no mesmo slot (use a mesma hash tag, ex.: {{user:1}}:a e \
             {{user:1}}:b): {err}"
        ));
    }
    AppError::Database(err.to_string())
}

/// `keys=12,expires=0,avg_ttl=0` → 12
fn keys_in(stats: &str) -> u32 {
    stats
        .split(',')
        .find_map(|stat| stat.strip_prefix("keys="))
        .and_then(|keys| keys.parse().ok())
        .unwrap_or(0)
}

/// `# Section` headers followed by `field:value` lines.
pub fn parse_info(text: &str) -> Vec<InfoSection> {
    let mut sections: Vec<InfoSection> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('#') {
            sections.push(InfoSection {
                name: name.trim().to_string(),
                entries: Vec::new(),
            });
        } else if let Some((field, value)) = line.split_once(':') {
            if sections.is_empty() {
                sections.push(InfoSection {
                    name: String::new(),
                    entries: Vec::new(),
                });
            }
            if let Some(section) = sections.last_mut() {
                section.entries.push((field.to_string(), value.to_string()));
            }
        }
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_parses_into_sections() {
        let text = "# Server\r\nredis_version:7.4.0\r\nos:Linux 6.1:x86_64\r\n\r\n# Keyspace\r\ndb0:keys=12,expires=1,avg_ttl=0\r\n";
        let sections = parse_info(text);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].name, "Server");
        assert_eq!(
            sections[0].entries,
            [
                ("redis_version".to_string(), "7.4.0".to_string()),
                // only the first colon separates
                ("os".to_string(), "Linux 6.1:x86_64".to_string())
            ]
        );
        assert_eq!(keys_in(&sections[1].entries[0].1), 12);
        assert_eq!(keys_in("garbage"), 0);
    }

    #[test]
    fn pairs_group_flat_replies() {
        let items = vec![b"a".to_vec(), b"1".to_vec(), b"b".to_vec(), b"2".to_vec()];
        let grouped: Vec<_> = pairs(items).collect();
        assert_eq!(
            grouped,
            [
                (b"a".to_vec(), b"1".to_vec()),
                (b"b".to_vec(), b"2".to_vec())
            ]
        );
    }
}
