pub mod reply;

#[cfg(test)]
pub(crate) mod integration_tests;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use redis::aio::MultiplexedConnection;
use redis::{
    AsyncConnectionConfig, Client, Cmd, ConnectionAddr, ConnectionInfo, FromRedisValue,
    IntoConnectionInfo, RedisConnectionInfo, RedisError, TlsCertificates, Value,
};
use tokio::sync::oneshot;

use crate::domain::{
    AppError, ConnectionConfig, HashEntry, InfoSection, KeyDetail, KeyEntry, KeyPage, PubSubEvent,
    RedisDatabase, RedisValue, StreamEntry, Target, TlsMode, ZsetEntry,
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

/// One multiplexed connection per logical database, opened on first use.
pub struct RedisAdapter {
    info: ConnectionInfo,
    config: AsyncConnectionConfig,
    default_db: u8,
    timeout_secs: u32,
    // never held across an await
    connections: Mutex<HashMap<u8, MultiplexedConnection>>,
    /// live sessions on dedicated connections (pub/sub), by id; dropping the
    /// sender ends the session
    streams: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl RedisAdapter {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<String>,
    ) -> Result<Self, AppError> {
        let Target::Network {
            host,
            port,
            database,
            username,
        } = &config.target
        else {
            return Err(AppError::validation("Redis precisa de host e porta"));
        };
        let default_db = if database.is_empty() {
            0
        } else {
            database
                .parse()
                .map_err(|_| AppError::validation("database do Redis deve ser um número"))?
        };

        let mut settings = RedisConnectionInfo::default();
        if !username.is_empty() {
            settings = settings.set_username(username);
        }
        if let Some(password) = password.filter(|p| !p.is_empty()) {
            settings = settings.set_password(password);
        }
        let info = connection_info(config, host, *port)?.set_redis_settings(settings);
        let timeout =
            (config.timeout_secs > 0).then(|| Duration::from_secs(u64::from(config.timeout_secs)));

        let adapter = Self {
            info,
            config: AsyncConnectionConfig::new()
                .set_connection_timeout(Some(CONNECT_TIMEOUT))
                .set_response_timeout(timeout),
            default_db,
            timeout_secs: config.timeout_secs,
            connections: Mutex::new(HashMap::new()),
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
        lock(&self.connections).clear();
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
        let client = Client::open(self.info.clone()).map_err(|err| self.error(err))?;
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

    async fn connection(&self, db: u8) -> Result<MultiplexedConnection, AppError> {
        if let Some(connection) = lock(&self.connections).get(&db) {
            return Ok(connection.clone());
        }
        let settings = self.info.redis_settings().clone().set_db(i64::from(db));
        let client = Client::open(self.info.clone().set_redis_settings(settings))
            .map_err(|err| self.error(err))?;
        let connection = client
            .get_multiplexed_async_connection_with_config(&self.config)
            .await
            .map_err(|err| self.error(err))?;
        lock(&self.connections).insert(db, connection.clone());
        Ok(connection)
    }

    /// A broken connection is dropped so the next call opens a new one.
    fn fail(&self, db: u8, err: RedisError) -> AppError {
        if err.is_unrecoverable_error() {
            lock(&self.connections).remove(&db);
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

    /// Databases 0..N (CONFIG GET databases; 16 when CONFIG is not allowed) with
    /// their key counts from INFO keyspace.
    pub async fn databases(&self) -> Result<Vec<RedisDatabase>, AppError> {
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
    // ponytail: names that are not UTF-8 are shown lossily and cannot be opened
    pub async fn scan(&self, db: u8, pattern: &str, cursor: &str) -> Result<KeyPage, AppError> {
        let mut cursor = cursor.to_string();
        let mut names: Vec<Vec<u8>> = Vec::new();
        for _ in 0..SCAN_ROUNDS {
            let (next, batch): (String, Vec<Vec<u8>>) = self
                .query(
                    db,
                    redis::cmd("SCAN")
                        .arg(&cursor)
                        .arg("MATCH")
                        .arg(pattern)
                        .arg("COUNT")
                        .arg(SCAN_COUNT),
                )
                .await?;
            names.extend(batch);
            cursor = next;
            if cursor == "0" || names.len() >= SCAN_TARGET {
                break;
            }
        }

        let mut pipe = redis::pipe();
        for name in &names {
            pipe.cmd("TYPE").arg(name);
        }
        let kinds: Vec<String> = if names.is_empty() {
            Vec::new()
        } else {
            let mut connection = self.connection(db).await?;
            pipe.query_async(&mut connection)
                .await
                .map_err(|err| self.fail(db, err))?
        };
        let keys = names
            .into_iter()
            .zip(kinds)
            // deleted between SCAN and TYPE
            .filter(|(_, kind)| kind != "none")
            .map(|(name, kind)| KeyEntry {
                name: String::from_utf8_lossy(&name).into_owned(),
                kind,
            })
            .collect();
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
        let text: String = self.query(self.default_db, &command).await?;
        Ok(parse_info(&text))
    }
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

fn pairs(items: Vec<Vec<u8>>) -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    let mut items = items.into_iter();
    std::iter::from_fn(move || Some((items.next()?, items.next()?)))
}

/// Redis has no opportunistic TLS: "prefer" connects in plain text. "require"
/// encrypts without checking the certificate, "verifyFull" checks it (system roots
/// or the configured CA).
fn connection_info(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<ConnectionInfo, AppError> {
    let tls = |insecure| ConnectionAddr::TcpTls {
        host: host.to_string(),
        port,
        insecure,
        tls_params: None,
    };
    let invalid = |err: RedisError| AppError::validation(format!("configuração inválida: {err}"));
    match (config.tls.mode, &config.tls.ca_cert_path) {
        (TlsMode::Disable | TlsMode::Prefer, _) => ConnectionAddr::Tcp(host.to_string(), port)
            .into_connection_info()
            .map_err(invalid),
        (TlsMode::Require, _) => tls(true).into_connection_info().map_err(invalid),
        (TlsMode::VerifyFull, None) => tls(false).into_connection_info().map_err(invalid),
        (TlsMode::VerifyFull, Some(path)) => {
            let root_cert = std::fs::read(path).map_err(|err| {
                AppError::validation(format!("não foi possível ler o CA {path}: {err}"))
            })?;
            let certificates = TlsCertificates {
                client_tls: None,
                root_cert: Some(root_cert),
            };
            Client::build_with_tls(tls(false), certificates)
                .map(|client| client.get_connection_info().clone())
                .map_err(invalid)
        }
    }
}

fn map_error(err: &RedisError, timeout_secs: u32) -> AppError {
    if err.is_timeout() {
        // nothing to cancel: Redis has no KILL for a running command
        return AppError::Timeout(format!(
            "comando excedeu o timeout de {timeout_secs}s (o Redis pode continuar executando-o)"
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
