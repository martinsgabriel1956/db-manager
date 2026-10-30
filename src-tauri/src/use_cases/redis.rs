use std::time::Instant;

use redis::Value;

use crate::adapters::redis::reply;
use crate::domain::{
    AppError, CommandOutcome, CommandResponse, Confirmation, Environment, InfoSection, KeyDetail,
    KeyEdit, KeyEditRequest, KeyEditResponse, KeyPage, LiveStart, MonitorEvent, PubSubEvent,
    RedisDatabase, RedisModule,
};
use crate::registry::Registry;
use crate::storage::history::HistoryStore;
use crate::use_cases::sql::{elapsed_ms, record};

const PROD_REASON: &str = "Conexão de produção: confirme antes de escrever";

/// Commands that only read. Anything else is a write: refused on read-only
/// connections, confirmed on prod. Container commands are listed with their
/// subcommand ("CONFIG GET"); a bare name covers every subcommand.
const READ_COMMANDS: &[&str] = &[
    // keys
    "EXISTS",
    "TYPE",
    "TTL",
    "PTTL",
    "EXPIRETIME",
    "PEXPIRETIME",
    "SCAN",
    "RANDOMKEY",
    "DBSIZE",
    "DUMP",
    "OBJECT",
    "MEMORY USAGE",
    "MEMORY STATS",
    "MEMORY DOCTOR",
    "SORT_RO",
    // strings and bitmaps
    "GET",
    "MGET",
    "STRLEN",
    "GETRANGE",
    "SUBSTR",
    "LCS",
    "GETBIT",
    "BITCOUNT",
    "BITPOS",
    "BITFIELD_RO",
    "PFCOUNT",
    // hashes
    "HGET",
    "HMGET",
    "HGETALL",
    "HKEYS",
    "HVALS",
    "HLEN",
    "HEXISTS",
    "HSTRLEN",
    "HSCAN",
    "HRANDFIELD",
    "HTTL",
    "HPTTL",
    // lists
    "LRANGE",
    "LLEN",
    "LINDEX",
    "LPOS",
    // sets
    "SMEMBERS",
    "SISMEMBER",
    "SMISMEMBER",
    "SCARD",
    "SSCAN",
    "SRANDMEMBER",
    "SINTER",
    "SUNION",
    "SDIFF",
    "SINTERCARD",
    // sorted sets
    "ZRANGE",
    "ZRANGEBYSCORE",
    "ZREVRANGE",
    "ZREVRANGEBYSCORE",
    "ZRANGEBYLEX",
    "ZREVRANGEBYLEX",
    "ZSCORE",
    "ZMSCORE",
    "ZCARD",
    "ZCOUNT",
    "ZLEXCOUNT",
    "ZRANK",
    "ZREVRANK",
    "ZSCAN",
    "ZRANDMEMBER",
    "ZINTER",
    "ZUNION",
    "ZDIFF",
    "ZINTERCARD",
    // streams (XREAD only without BLOCK, refused below)
    "XRANGE",
    "XREVRANGE",
    "XLEN",
    "XREAD",
    "XINFO",
    "XPENDING",
    // geo
    "GEOPOS",
    "GEODIST",
    "GEOHASH",
    "GEOSEARCH",
    "GEORADIUS_RO",
    "GEORADIUSBYMEMBER_RO",
    // scripts the server itself keeps read-only
    "EVAL_RO",
    "EVALSHA_RO",
    "FCALL_RO",
    // RedisJSON
    "JSON.GET",
    "JSON.MGET",
    "JSON.TYPE",
    "JSON.STRLEN",
    "JSON.ARRLEN",
    "JSON.ARRINDEX",
    "JSON.OBJKEYS",
    "JSON.OBJLEN",
    "JSON.RESP",
    "JSON.DEBUG MEMORY",
    // server
    "PING",
    "ECHO",
    "INFO",
    "TIME",
    "LASTSAVE",
    "COMMAND",
    "CONFIG GET",
    "MODULE LIST",
    "CLIENT LIST",
    "CLIENT INFO",
    "CLIENT GETNAME",
    "CLIENT ID",
    "SLOWLOG GET",
    "SLOWLOG LEN",
    "LATENCY LATEST",
    "ROLE",
    "LOLWUT",
    "CLUSTER INFO",
    "CLUSTER NODES",
    "CLUSTER SLOTS",
    "CLUSTER SHARDS",
    "CLUSTER MYID",
    "CLUSTER KEYSLOT",
    "CLUSTER COUNTKEYSINSLOT",
];

/// Writes that always ask first, wherever they run.
const DESTRUCTIVE_COMMANDS: &[(&str, &str)] = &[
    ("FLUSHDB", "apaga todas as chaves do database"),
    ("FLUSHALL", "apaga todas as chaves de todos os databases"),
    ("SWAPDB", "troca o conteúdo de dois databases"),
    ("SHUTDOWN", "desliga o servidor"),
    ("DEBUG", "pode travar ou derrubar o servidor"),
    (
        "KEYS",
        "percorre todas as chaves e bloqueia o servidor enquanto isso (prefira SCAN)",
    ),
    ("CONFIG SET", "altera a configuração do servidor"),
    ("CONFIG RESETSTAT", "zera as estatísticas do servidor"),
    ("CONFIG REWRITE", "reescreve o arquivo de configuração"),
    ("SCRIPT FLUSH", "apaga os scripts carregados"),
    ("FUNCTION FLUSH", "apaga as funções carregadas"),
    (
        "REPLICAOF",
        "muda a replicação e pode apagar os dados deste servidor",
    ),
    (
        "SLAVEOF",
        "muda a replicação e pode apagar os dados deste servidor",
    ),
    ("CLIENT KILL", "derruba conexões de clientes"),
    ("CLUSTER RESET", "tira este nó do cluster"),
    ("CLUSTER FAILOVER", "troca o primário do shard"),
];

/// Commands the console cannot run: they would hang or change the state of the
/// connection the whole app shares with that database.
const REFUSED_COMMANDS: &[(&str, &str)] = &[
    ("SELECT", "use a aba do database em vez de SELECT"),
    (
        "SUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    (
        "PSUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    (
        "SSUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    (
        "UNSUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    (
        "PUNSUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    (
        "SUNSUBSCRIBE",
        "o console não assina canais: use a seção Pub/sub",
    ),
    ("MONITOR", "o console não roda MONITOR: use a seção Monitor"),
    ("MULTI", "transações não são suportadas no console"),
    ("EXEC", "transações não são suportadas no console"),
    ("DISCARD", "transações não são suportadas no console"),
    ("WATCH", "transações não são suportadas no console"),
    ("UNWATCH", "transações não são suportadas no console"),
    ("AUTH", "a autenticação vem da conexão cadastrada"),
    ("HELLO", "a conexão já negociou o protocolo"),
    ("QUIT", "feche a aba em vez de QUIT"),
    ("RESET", "RESET não é suportado no console"),
];

const BLOCKING_COMMANDS: &[&str] = &[
    "BLPOP",
    "BRPOP",
    "BLMOVE",
    "BRPOPLPUSH",
    "BLMPOP",
    "BZPOPMIN",
    "BZPOPMAX",
    "BZMPOP",
    "WAIT",
    "WAITAOF",
];

#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    Refused(String),
    Read,
    Write,
    Destructive(&'static str),
}

/// `args` are the command words; the name and subcommand are case-insensitive.
fn classify(args: &[String]) -> Verdict {
    let name = args[0].to_uppercase();
    let full = match args.get(1) {
        Some(sub) => format!("{name} {}", sub.to_uppercase()),
        None => name.clone(),
    };
    let lookup = |list: &[(&str, &'static str)]| {
        list.iter()
            .find(|(command, _)| *command == full || *command == name)
            .map(|(_, reason)| *reason)
    };

    if let Some(reason) = lookup(REFUSED_COMMANDS) {
        return Verdict::Refused(reason.to_string());
    }
    let blocks = BLOCKING_COMMANDS.contains(&name.as_str())
        || (name.starts_with("XREAD") && args.iter().any(|arg| arg.eq_ignore_ascii_case("BLOCK")));
    if blocks {
        return Verdict::Refused(format!(
            "{name} bloqueante travaria a conexão compartilhada; use a versão sem bloqueio"
        ));
    }
    if let Some(reason) = lookup(DESTRUCTIVE_COMMANDS) {
        return Verdict::Destructive(reason);
    }
    if READ_COMMANDS.contains(&full.as_str()) || READ_COMMANDS.contains(&name.as_str()) {
        return Verdict::Read;
    }
    Verdict::Write
}

pub async fn databases(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<RedisDatabase>, AppError> {
    registry
        .connection(connection_id)?
        .redis()?
        .databases()
        .await
}

pub async fn scan_keys(
    registry: &Registry,
    connection_id: &str,
    db: u8,
    pattern: &str,
    cursor: &str,
) -> Result<KeyPage, AppError> {
    let pattern = if pattern.trim().is_empty() {
        "*"
    } else {
        pattern
    };
    // a cluster's cursor is "<primary index>:<cursor>"
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    let valid = match cursor.split_once(':') {
        Some((node, rest)) => digits(node) && digits(rest),
        None => digits(cursor),
    };
    if !valid {
        return Err(AppError::validation("cursor de SCAN inválido"));
    }
    registry
        .connection(connection_id)?
        .redis()?
        .scan(db, pattern, cursor)
        .await
}

pub async fn read_key(
    registry: &Registry,
    connection_id: &str,
    db: u8,
    key: &str,
) -> Result<KeyDetail, AppError> {
    registry
        .connection(connection_id)?
        .redis()?
        .read_key(db, key)
        .await
}

pub async fn server_modules(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<RedisModule>, AppError> {
    registry.connection(connection_id)?.redis()?.modules().await
}

pub async fn server_info(
    registry: &Registry,
    connection_id: &str,
) -> Result<Vec<InfoSection>, AppError> {
    registry
        .connection(connection_id)?
        .redis()?
        .info(None)
        .await
}

/// The command implementing an edit, as arguments.
fn edit_args(key: &str, edit: &KeyEdit) -> Result<Vec<String>, AppError> {
    let args: Vec<&str> = match edit {
        KeyEdit::SetString { value } => vec!["SET", key, value, "KEEPTTL"],
        KeyEdit::HashSet { field, value } => vec!["HSET", key, field, value],
        KeyEdit::HashDelete { field } => vec!["HDEL", key, field],
        KeyEdit::ListSet { index, value } => {
            return Ok(owned(&["LSET", key, &index.to_string(), value]));
        }
        KeyEdit::ListPush { value } => vec!["RPUSH", key, value],
        KeyEdit::ListRemove { value } => vec!["LREM", key, "1", value],
        KeyEdit::SetAdd { member } => vec!["SADD", key, member],
        KeyEdit::SetRemove { member } => vec!["SREM", key, member],
        KeyEdit::ZsetAdd { member, score } => {
            let valid = score.trim().parse::<f64>().is_ok_and(|s| !s.is_nan());
            if !valid {
                return Err(AppError::validation(format!("score inválido: {score}")));
            }
            vec!["ZADD", key, score.trim(), member]
        }
        KeyEdit::ZsetRemove { member } => vec!["ZREM", key, member],
        // EXPIRE 0 would delete the key
        KeyEdit::Expire { ttl_secs: Some(0) } => {
            return Err(AppError::validation("TTL deve ser de pelo menos 1 segundo"));
        }
        KeyEdit::Expire {
            ttl_secs: Some(ttl),
        } => return Ok(owned(&["EXPIRE", key, &ttl.to_string()])),
        KeyEdit::Expire { ttl_secs: None } => vec!["PERSIST", key],
        KeyEdit::JsonSet { json } => {
            // checked here so a typo is not sent; the text itself goes as typed
            if let Err(err) = serde_json::from_str::<serde::de::IgnoredAny>(json) {
                return Err(AppError::validation(format!("JSON inválido: {err}")));
            }
            if let Some(number) = oversized_integer(json) {
                return Err(AppError::validation(format!(
                    "o RedisJSON guarda inteiros de até 64 bits: {number} viraria um float \
                     arredondado; grave-o como string"
                )));
            }
            vec!["JSON.SET", key, "$", json]
        }
        KeyEdit::Rename { new_key } if new_key.is_empty() || new_key == key => {
            return Err(AppError::validation("informe um nome novo para a chave"));
        }
        KeyEdit::Rename { new_key } => vec!["RENAMENX", key, new_key],
        KeyEdit::Delete => vec!["DEL", key],
    };
    Ok(owned(&args))
}

/// The first integer literal (outside strings) of valid JSON that fits neither
/// i64 nor u64: RedisJSON would store it as a rounded double.
fn oversized_integer(json: &str) -> Option<&str> {
    let bytes = json.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
                i += 1;
            }
            b'-' | b'0'..=b'9' => {
                let start = i;
                while i < bytes.len()
                    && matches!(bytes[i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    i += 1;
                }
                let token = &json[start..i];
                let integer = !token.contains(['.', 'e', 'E']);
                if integer && token.parse::<i64>().is_err() && token.parse::<u64>().is_err() {
                    return Some(token);
                }
            }
            _ => i += 1,
        }
    }
    None
}

fn owned(args: &[&str]) -> Vec<String> {
    args.iter().map(ToString::to_string).collect()
}

/// Applies the edits to one key in a MULTI/EXEC. Refused on read-only connections,
/// confirmed on prod. Last write wins: there is no check that the value is still
/// the one on screen.
pub async fn edit_key(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    request: KeyEditRequest,
    confirmed: bool,
) -> Result<KeyEditResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let redis = connection.redis()?;
    if connection.read_only {
        return Err(AppError::read_only(&connection.name));
    }
    let KeyEditRequest {
        db,
        key,
        edits,
        create,
    } = request;
    if key.is_empty() {
        return Err(AppError::validation("informe o nome da chave"));
    }
    if edits.is_empty() {
        return Err(AppError::validation("nenhuma alteração para aplicar"));
    }
    let renames_or_deletes = edits
        .iter()
        .any(|edit| matches!(edit, KeyEdit::Rename { .. } | KeyEdit::Delete));
    if renames_or_deletes && edits.len() > 1 {
        return Err(AppError::validation(
            "renomear ou excluir a chave não combina com outras alterações",
        ));
    }
    let commands = edits
        .iter()
        .map(|edit| edit_args(&key, edit))
        .collect::<Result<Vec<_>, _>>()?;
    let statements: Vec<String> = commands
        .iter()
        .map(|args| reply::command_line(&args.iter().map(String::as_str).collect::<Vec<_>>()))
        .collect();

    if connection.environment == Environment::Prod && !confirmed {
        return Ok(KeyEditResponse::NeedsConfirmation {
            confirmation: Confirmation {
                marks: Vec::new(),
                reason: PROD_REASON.to_string(),
                statements,
                destructive: false,
            },
        });
    }
    // ponytail: EXISTS then write is racy; a concurrent creator in between is overwritten
    if create && redis.exists(db, &key).await? {
        return Err(AppError::Conflict(format!("a chave {key} já existe")));
    }

    let started = Instant::now();
    let result =
        redis
            .atomic(db, &commands)
            .await
            .and_then(|replies| match (&edits[0], replies.first()) {
                (KeyEdit::Rename { new_key }, Some(Value::Int(0))) => {
                    Err(AppError::Conflict(format!("a chave {new_key} já existe")))
                }
                _ => Ok(()),
            });
    record(
        history,
        connection_id,
        &connection,
        &format!("SELECT {db}\n{}", statements.join("\n")),
        elapsed_ms(started),
        result.as_ref().err(),
    )
    .await;
    result.map(|()| KeyEditResponse::Applied)
}

/// One console line. Refuses what the shared connection cannot run, applies the
/// read-only allowlist, and confirms destructive commands (any write on prod).
pub async fn run_command(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    db: u8,
    line: &str,
    confirmed: bool,
) -> Result<CommandResponse, AppError> {
    let args = reply::split_args(line).map_err(AppError::validation)?;
    if args.is_empty() {
        return Err(AppError::validation("nenhum comando para executar"));
    }
    execute(
        registry,
        history,
        connection_id,
        db,
        args,
        line.trim().to_string(),
        confirmed,
    )
    .await
}

/// Runs one command (as arguments) under the console rules; `statement` is what
/// the confirmation and the history show.
async fn execute(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    db: u8,
    args: Vec<Vec<u8>>,
    statement: String,
    confirmed: bool,
) -> Result<CommandResponse, AppError> {
    let connection = registry.connection(connection_id)?;
    let redis = connection.redis()?;
    let words: Vec<String> = args
        .iter()
        .map(|arg| String::from_utf8_lossy(arg).into_owned())
        .collect();

    let verdict = classify(&words);
    if let Verdict::Refused(reason) = verdict {
        return Err(AppError::validation(reason));
    }
    if connection.read_only && verdict != Verdict::Read {
        return Err(AppError::read_only(&connection.name));
    }
    let destructive = matches!(verdict, Verdict::Destructive(_));
    let reason = match verdict {
        Verdict::Destructive(reason) => Some(format!("Comando destrutivo: {reason}")),
        Verdict::Write if connection.environment == Environment::Prod => {
            Some(PROD_REASON.to_string())
        }
        _ => None,
    };
    if let Some(reason) = reason
        && !confirmed
    {
        return Ok(CommandResponse::NeedsConfirmation {
            confirmation: Confirmation {
                marks: Vec::new(),
                reason,
                statements: vec![statement],
                destructive,
            },
        });
    }

    let started = Instant::now();
    let result = redis.command(db, &args).await;
    let duration_ms = elapsed_ms(started);
    record(
        history,
        connection_id,
        &connection,
        &format!("SELECT {db}\n{statement}"),
        duration_ms,
        result.as_ref().err(),
    )
    .await;
    Ok(CommandResponse::Executed {
        outcome: CommandOutcome {
            output: result?,
            duration_ms,
        },
    })
}

/// PUBLISH from the pub/sub panel: a write like any other (refused on read-only
/// connections, confirmed on prod, recorded in the history).
pub async fn publish(
    registry: &Registry,
    history: &HistoryStore,
    connection_id: &str,
    db: u8,
    channel: &str,
    message: &str,
    confirmed: bool,
) -> Result<CommandResponse, AppError> {
    if channel.is_empty() {
        return Err(AppError::validation("informe o canal"));
    }
    let args = ["PUBLISH", channel, message];
    execute(
        registry,
        history,
        connection_id,
        db,
        args.iter().map(|arg| arg.as_bytes().to_vec()).collect(),
        reply::command_line(&args),
        confirmed,
    )
    .await
}

/// Starts a subscription to the channels and patterns (blank ones ignored). Only
/// reads: allowed on read-only and prod connections without asking.
pub async fn subscribe(
    registry: &Registry,
    connection_id: &str,
    session_id: &str,
    channels: &[String],
    patterns: &[String],
    send: impl Fn(PubSubEvent) -> bool + Send + 'static,
) -> Result<(), AppError> {
    let names = |list: &[String]| -> Vec<String> {
        list.iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect()
    };
    let (channels, patterns) = (names(channels), names(patterns));
    if channels.is_empty() && patterns.is_empty() {
        return Err(AppError::validation("informe ao menos um canal ou padrão"));
    }
    registry
        .connection(connection_id)?
        .redis()?
        .subscribe(session_id, &channels, &patterns, send)
        .await
}

/// Starts MONITOR. It changes no data (allowed on read-only connections) but
/// costs the server on every command, so prod asks first.
pub async fn monitor(
    registry: &Registry,
    connection_id: &str,
    session_id: &str,
    confirmed: bool,
    send: impl Fn(MonitorEvent) -> bool + Send + 'static,
) -> Result<LiveStart, AppError> {
    let connection = registry.connection(connection_id)?;
    let redis = connection.redis()?;
    if connection.environment == Environment::Prod && !confirmed {
        return Ok(LiveStart::NeedsConfirmation {
            confirmation: Confirmation {
                marks: Vec::new(),
                reason: "Conexão de produção: MONITOR envia a este app cada comando do \
                         servidor e pesa no desempenho dele enquanto roda"
                    .to_string(),
                statements: vec!["MONITOR".to_string()],
                destructive: false,
            },
        });
    }
    redis.monitor(session_id, send).await?;
    Ok(LiveStart::Started)
}

/// Ends a live session. The connection may already be closed (which ended it).
pub fn stop_session(registry: &Registry, connection_id: &str, session_id: &str) {
    if let Ok(connection) = registry.connection(connection_id)
        && let Ok(redis) = connection.redis()
    {
        redis.stop(session_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verdict(line: &str) -> Verdict {
        let words: Vec<String> = line.split_whitespace().map(String::from).collect();
        classify(&words)
    }

    #[test]
    fn commands_are_classified() {
        let cases = [
            ("get k", Verdict::Read),
            ("HGETALL k", Verdict::Read),
            ("config get maxmemory", Verdict::Read),
            ("XREAD COUNT 1 STREAMS s 0", Verdict::Read),
            ("OBJECT ENCODING k", Verdict::Read),
            ("set k v", Verdict::Write),
            ("DEL k", Verdict::Write),
            ("EVAL return 1 0", Verdict::Write),
            ("XREADGROUP GROUP g c STREAMS s >", Verdict::Write),
            (
                "CONFIG RESETSTAT",
                Verdict::Destructive("zera as estatísticas do servidor"),
            ),
            (
                "flushdb",
                Verdict::Destructive("apaga todas as chaves do database"),
            ),
            (
                "FLUSHALL ASYNC",
                Verdict::Destructive("apaga todas as chaves de todos os databases"),
            ),
            (
                "keys *",
                Verdict::Destructive(
                    "percorre todas as chaves e bloqueia o servidor enquanto isso (prefira SCAN)",
                ),
            ),
            (
                "config set maxmemory 1",
                Verdict::Destructive("altera a configuração do servidor"),
            ),
            ("NEWMODULE.CMD x", Verdict::Write),
        ];
        for (line, expected) in cases {
            assert_eq!(verdict(line), expected, "{line}");
        }
    }

    #[test]
    fn console_refuses_what_the_shared_connection_cannot_run() {
        for line in [
            "SELECT 1",
            "subscribe news",
            "MULTI",
            "BLPOP q 0",
            "XREAD BLOCK 0 STREAMS s $",
            "xreadgroup group g c block 100 streams s >",
            "AUTH user pass",
        ] {
            assert!(
                matches!(verdict(line), Verdict::Refused(_)),
                "{line} should be refused"
            );
        }
        // pub/sub has its own panel, on a dedicated connection
        assert!(matches!(verdict("PSUBSCRIBE a*"), Verdict::Refused(r) if r.contains("Pub/sub")));
    }

    #[test]
    fn integers_past_64_bits_are_found_outside_strings() {
        assert_eq!(
            oversized_integer(r#"[-9223372036854775808, 18446744073709551615]"#),
            None
        );
        assert_eq!(oversized_integer(r#"{"a": 1e400, "b": 1.5}"#), None);
        assert_eq!(
            oversized_integer(r#"{"s": "99999999999999999999 \\\" 1"}"#),
            None
        );
        assert_eq!(
            oversized_integer(r#"{"s": "x", "n": [1, 18446744073709551616]}"#),
            Some("18446744073709551616")
        );
        assert_eq!(
            oversized_integer("-9223372036854775809"),
            Some("-9223372036854775809")
        );
    }

    #[test]
    fn edits_become_commands() {
        let args = |edit: KeyEdit| edit_args("k", &edit).unwrap();
        assert_eq!(
            args(KeyEdit::SetString { value: "v".into() }),
            ["SET", "k", "v", "KEEPTTL"]
        );
        assert_eq!(
            args(KeyEdit::ListSet {
                index: 3,
                value: "v".into()
            }),
            ["LSET", "k", "3", "v"]
        );
        assert_eq!(
            args(KeyEdit::ZsetAdd {
                member: "m".into(),
                score: " -inf ".into()
            }),
            ["ZADD", "k", "-inf", "m"]
        );
        assert_eq!(
            args(KeyEdit::Expire { ttl_secs: Some(60) }),
            ["EXPIRE", "k", "60"]
        );
        assert_eq!(args(KeyEdit::Expire { ttl_secs: None }), ["PERSIST", "k"]);
        assert_eq!(
            args(KeyEdit::Rename {
                new_key: "k2".into()
            }),
            ["RENAMENX", "k", "k2"]
        );

        assert_eq!(
            args(KeyEdit::JsonSet {
                json: r#"{"n": 12345678901234567890}"#.into()
            }),
            ["JSON.SET", "k", "$", r#"{"n": 12345678901234567890}"#]
        );

        let invalid = [
            KeyEdit::JsonSet {
                json: "{bad".into(),
            },
            KeyEdit::ZsetAdd {
                member: "m".into(),
                score: "abc".into(),
            },
            KeyEdit::ZsetAdd {
                member: "m".into(),
                score: "nan".into(),
            },
            KeyEdit::Expire { ttl_secs: Some(0) },
            KeyEdit::Rename {
                new_key: "k".into(),
            },
        ];
        for edit in invalid {
            assert!(edit_args("k", &edit).is_err(), "{edit:?}");
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::adapters::redis::integration_tests::start;
    use crate::domain::{ConnectionConfig, RedisText, RedisValue};
    use crate::storage::secrets::SecretStore;
    use crate::use_cases::redis::server_modules;
    use crate::use_cases::sql;

    struct NoPassword;

    impl SecretStore for NoPassword {
        fn get(&self, _: &str) -> Result<Option<String>, AppError> {
            Ok(None)
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
        sql::connect(registry, &NoPassword, config.clone())
            .await
            .unwrap();
    }

    fn request(key: &str, edits: Vec<KeyEdit>) -> KeyEditRequest {
        KeyEditRequest {
            db: 0,
            key: key.into(),
            edits,
            create: false,
        }
    }

    async fn edit(
        registry: &Registry,
        history: &HistoryStore,
        request: KeyEditRequest,
    ) -> Result<KeyEditResponse, AppError> {
        edit_key(registry, history, "redis", request, false).await
    }

    async fn console(
        registry: &Registry,
        history: &HistoryStore,
        line: &str,
        confirmed: bool,
    ) -> Result<CommandResponse, AppError> {
        run_command(registry, history, "redis", 0, line, confirmed).await
    }

    fn output(response: CommandResponse) -> String {
        match response {
            CommandResponse::Executed { outcome } => outcome.output,
            CommandResponse::NeedsConfirmation { .. } => panic!("unexpected confirmation"),
        }
    }

    #[tokio::test]
    async fn edits_create_rename_and_delete_keys() {
        let (_container, config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        open(&registry, &config).await;

        let create = KeyEditRequest {
            create: true,
            ..request(
                "user:1",
                vec![
                    KeyEdit::HashSet {
                        field: "name".into(),
                        value: "Ana".into(),
                    },
                    KeyEdit::Expire {
                        ttl_secs: Some(300),
                    },
                ],
            )
        };
        assert_eq!(
            edit(&registry, &history, create.clone()).await.unwrap(),
            KeyEditResponse::Applied
        );
        // creating it again is a conflict
        assert!(matches!(
            edit(&registry, &history, create).await,
            Err(AppError::Conflict(_))
        ));

        // renaming a field = set the new one, then delete the old, in one transaction.
        // Deleting first would empty the hash, and Redis drops empty keys (with their TTL).
        edit(
            &registry,
            &history,
            request(
                "user:1",
                vec![
                    KeyEdit::HashSet {
                        field: "full_name".into(),
                        value: "Ana Maria".into(),
                    },
                    KeyEdit::HashDelete {
                        field: "name".into(),
                    },
                ],
            ),
        )
        .await
        .unwrap();
        let detail = read_key(&registry, "redis", 0, "user:1").await.unwrap();
        let RedisValue::Hash { entries } = detail.value else {
            panic!("hash expected");
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].field.text, "full_name");
        assert!(detail.ttl_secs.is_some(), "edits keep the TTL");

        // EXEC has no rollback: a command failing inside it (WRONGTYPE) is reported,
        // but the ones before it stay applied
        let failed = edit(
            &registry,
            &history,
            request(
                "user:1",
                vec![
                    KeyEdit::HashSet {
                        field: "extra".into(),
                        value: "1".into(),
                    },
                    KeyEdit::ListPush { value: "x".into() },
                ],
            ),
        )
        .await;
        assert!(
            matches!(&failed, Err(AppError::Database(m)) if m.contains("WRONGTYPE")),
            "{failed:?}"
        );
        let RedisValue::Hash { entries } = read_key(&registry, "redis", 0, "user:1")
            .await
            .unwrap()
            .value
        else {
            panic!("still a hash");
        };
        assert_eq!(entries.len(), 2);

        output(
            console(&registry, &history, "SET other 1", false)
                .await
                .unwrap(),
        );
        output(
            console(&registry, &history, "SET name 1", false)
                .await
                .unwrap(),
        );
        assert!(matches!(
            edit(
                &registry,
                &history,
                request(
                    "name",
                    vec![KeyEdit::Rename {
                        new_key: "other".into()
                    }]
                )
            )
            .await,
            Err(AppError::Conflict(_))
        ));
        edit(
            &registry,
            &history,
            request(
                "name",
                vec![KeyEdit::Rename {
                    new_key: "renamed".into(),
                }],
            ),
        )
        .await
        .unwrap();
        edit(
            &registry,
            &history,
            request("renamed", vec![KeyEdit::Delete]),
        )
        .await
        .unwrap();
        assert!(matches!(
            read_key(&registry, "redis", 0, "renamed").await,
            Err(AppError::NotFound(_))
        ));

        assert!(matches!(
            edit(
                &registry,
                &history,
                request("other", vec![KeyEdit::Delete, KeyEdit::Delete])
            )
            .await,
            Err(AppError::Validation(_))
        ));

        let entries = history.search("", Some("redis"), false, 50).await.unwrap();
        assert!(
            entries
                .iter()
                .any(|e| e.sql == "SELECT 0\nRENAMENX name renamed")
        );
        assert!(entries.iter().any(|e| e.error.is_some()));
    }

    #[tokio::test]
    async fn read_only_and_prod_rules() {
        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;

        config.read_only = true;
        open(&registry, &config).await;
        assert_eq!(
            output(console(&registry, &history, "GET k", false).await.unwrap()),
            "(nil)"
        );
        for line in ["SET k v", "FLUSHALL", "KEYS *"] {
            assert!(
                matches!(
                    console(&registry, &history, line, true).await,
                    Err(AppError::ReadOnly(_))
                ),
                "{line}"
            );
        }
        assert!(matches!(
            edit(&registry, &history, request("k", vec![KeyEdit::Delete])).await,
            Err(AppError::ReadOnly(_))
        ));
        assert!(matches!(
            console(&registry, &history, "SELECT 1", false).await,
            Err(AppError::Validation(_))
        ));

        config.read_only = false;
        config.environment = Environment::Prod;
        open(&registry, &config).await;
        // prod: every write asks, showing the generated command
        let CommandResponse::NeedsConfirmation { confirmation } =
            console(&registry, &history, "SET k v", false)
                .await
                .unwrap()
        else {
            panic!("confirmation expected");
        };
        assert_eq!(confirmation.statements, ["SET k v"]);
        let KeyEditResponse::NeedsConfirmation { confirmation } = edit(
            &registry,
            &history,
            request(
                "k",
                vec![KeyEdit::SetString {
                    value: "a b".into(),
                }],
            ),
        )
        .await
        .unwrap() else {
            panic!("confirmation expected");
        };
        assert_eq!(confirmation.statements, [r#"SET k "a b" KEEPTTL"#]);
        // nothing ran before confirming
        assert_eq!(
            output(
                console(&registry, &history, "EXISTS k", false)
                    .await
                    .unwrap()
            ),
            "(integer) 0"
        );
        output(console(&registry, &history, "SET k v", true).await.unwrap());

        // destructive commands ask everywhere
        config.environment = Environment::Local;
        open(&registry, &config).await;
        assert!(matches!(
            console(&registry, &history, "flushdb", false)
                .await
                .unwrap(),
            CommandResponse::NeedsConfirmation { .. }
        ));
        assert_eq!(
            output(console(&registry, &history, "flushdb", true).await.unwrap()),
            "OK"
        );
        assert_eq!(databases(&registry, "redis").await.unwrap()[0].keys, 0);
    }

    async fn next<T>(rx: &mut tokio::sync::mpsc::UnboundedReceiver<T>) -> T {
        tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
            .await
            .expect("event in time")
            .expect("channel open")
    }

    #[tokio::test]
    async fn pubsub_listens_on_its_own_connection_until_stopped() {
        use tokio::sync::mpsc;

        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;

        // read-only: subscribing only reads, publishing is a write
        config.read_only = true;
        open(&registry, &config).await;
        let (tx, mut first) = mpsc::unbounded_channel();
        subscribe(
            &registry,
            "redis",
            "s1",
            &["news".into()],
            &[],
            move |event| tx.send(event).is_ok(),
        )
        .await
        .unwrap();
        assert!(matches!(
            publish(&registry, &history, "redis", 0, "news", "x", true).await,
            Err(AppError::ReadOnly(_))
        ));
        assert!(matches!(
            subscribe(&registry, "redis", "s0", &[" ".into()], &[], |_| true).await,
            Err(AppError::Validation(_))
        ));

        // closing the connection ends its subscriptions
        config.read_only = false;
        config.environment = Environment::Prod;
        open(&registry, &config).await;
        assert_eq!(
            next(&mut first).await,
            PubSubEvent::Ended {
                reason: "assinatura encerrada".into()
            }
        );

        let (tx, mut events) = mpsc::unbounded_channel();
        subscribe(
            &registry,
            "redis",
            "s2",
            &["news".into()],
            &["user:*".into()],
            move |event| tx.send(event).is_ok(),
        )
        .await
        .unwrap();
        // prod: PUBLISH asks first, showing the command
        let CommandResponse::NeedsConfirmation { confirmation } =
            publish(&registry, &history, "redis", 0, "news", "olá mundo", false)
                .await
                .unwrap()
        else {
            panic!("confirmation expected");
        };
        assert_eq!(confirmation.statements, [r#"PUBLISH news "olá mundo""#]);
        assert_eq!(
            output(
                publish(&registry, &history, "redis", 0, "news", "olá mundo", true)
                    .await
                    .unwrap()
            ),
            "(integer) 1"
        );
        let text = |value: &str, binary| RedisText {
            text: value.into(),
            binary,
        };
        assert_eq!(
            next(&mut events).await,
            PubSubEvent::Message {
                channel: text("news", false),
                pattern: None,
                payload: text("olá mundo", false),
            }
        );
        // binary payloads arrive escaped, with the pattern that matched
        output(
            console(&registry, &history, r#"PUBLISH user:1 "\xff""#, true)
                .await
                .unwrap(),
        );
        assert_eq!(
            next(&mut events).await,
            PubSubEvent::Message {
                channel: text("user:1", false),
                pattern: Some(text("user:*", false)),
                payload: text(r"\xff", true),
            }
        );

        stop_session(&registry, "redis", "s2");
        assert!(matches!(next(&mut events).await, PubSubEvent::Ended { .. }));
        assert_eq!(
            output(
                publish(&registry, &history, "redis", 0, "news", "x", true)
                    .await
                    .unwrap()
            ),
            "(integer) 0"
        );
        let entries = history
            .search("PUBLISH", Some("redis"), false, 10)
            .await
            .unwrap();
        assert!(
            entries
                .iter()
                .any(|e| e.sql == "SELECT 0\nPUBLISH news \"olá mundo\"")
        );
    }

    #[tokio::test]
    async fn monitor_streams_commands_and_asks_first_on_prod() {
        use tokio::sync::mpsc;

        let (_container, mut config) = start().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        config.environment = Environment::Prod;
        config.read_only = true;
        open(&registry, &config).await;

        let (tx, mut events) = mpsc::unbounded_channel();
        let send = move |event| tx.send(event).is_ok();
        let LiveStart::NeedsConfirmation { confirmation } =
            monitor(&registry, "redis", "m1", false, send.clone())
                .await
                .unwrap()
        else {
            panic!("confirmation expected");
        };
        assert_eq!(confirmation.statements, ["MONITOR"]);
        // read-only does not stop it: MONITOR changes no data
        assert_eq!(
            monitor(&registry, "redis", "m1", true, send).await.unwrap(),
            LiveStart::Started
        );
        output(
            console(&registry, &history, "GET \"a b\"", false)
                .await
                .unwrap(),
        );
        let MonitorEvent::Line { text } = next(&mut events).await else {
            panic!("line expected");
        };
        assert!(text.ends_with(r#""GET" "a b""#), "{text}");

        stop_session(&registry, "redis", "m1");
        assert_eq!(
            next(&mut events).await,
            MonitorEvent::Ended {
                reason: "MONITOR encerrado".into()
            }
        );

        // it stops by itself at the line limit
        use crate::adapters::redis::MONITOR_MAX_LINES;
        let (tx, mut events) = mpsc::unbounded_channel();
        monitor(&registry, "redis", "m2", true, move |event| {
            tx.send(event).is_ok()
        })
        .await
        .unwrap();
        let pings = vec![vec!["PING".to_string()]; MONITOR_MAX_LINES as usize + 10];
        let connection = registry.connection("redis").unwrap();
        connection.redis().unwrap().atomic(0, &pings).await.unwrap();
        let mut lines = 0;
        let reason = loop {
            match next(&mut events).await {
                MonitorEvent::Line { .. } => lines += 1,
                MonitorEvent::Ended { reason } => break reason,
            }
        };
        assert_eq!(lines, MONITOR_MAX_LINES);
        assert_eq!(
            reason,
            format!("parou sozinho após {MONITOR_MAX_LINES} linhas")
        );
    }

    #[tokio::test]
    async fn modules_are_listed_and_redisjson_is_edited() {
        let (_container, mut config) =
            crate::adapters::redis::integration_tests::start_stack().await;
        let registry = Registry::default();
        let history = HistoryStore::in_memory().await;
        open(&registry, &config).await;
        let document = r#"{"n":12345678901234567890,"s":"olá","l":[1,null]}"#;
        for line in [
            format!("JSON.SET doc $ '{document}'"),
            "EXPIRE doc 600".to_string(),
            "BF.ADD bloom x".to_string(),
        ] {
            output(console(&registry, &history, &line, false).await.unwrap());
        }

        let modules = server_modules(&registry, "redis").await.unwrap();
        assert!(
            modules
                .iter()
                .any(|m| m.name == "ReJSON" && !m.version.is_empty()),
            "{modules:?}"
        );

        // module types show in the tree by name; RedisJSON opens as JSON, exactly as stored
        let page = scan_keys(&registry, "redis", 0, "*", "0").await.unwrap();
        let kind = |name: &str| {
            page.keys
                .iter()
                .find(|k| k.name == name)
                .map(|k| k.kind.clone())
        };
        assert_eq!(kind("doc").as_deref(), Some("ReJSON-RL"));
        assert_eq!(kind("bloom").as_deref(), Some("MBbloom--"));
        let detail = read_key(&registry, "redis", 0, "doc").await.unwrap();
        assert_eq!(
            detail.value,
            RedisValue::Json {
                json: document.into()
            }
        );
        assert_eq!(
            read_key(&registry, "redis", 0, "bloom")
                .await
                .unwrap()
                .value,
            RedisValue::Unsupported {
                type_name: "MBbloom--".into()
            }
        );

        let set = |json: &str| request("doc", vec![KeyEdit::JsonSet { json: json.into() }]);
        let replaced = r#"{"n":18446744073709551615}"#;
        assert_eq!(
            edit(&registry, &history, set(replaced)).await.unwrap(),
            KeyEditResponse::Applied
        );
        let detail = read_key(&registry, "redis", 0, "doc").await.unwrap();
        assert_eq!(
            detail.value,
            RedisValue::Json {
                json: replaced.into()
            }
        );
        assert!(detail.ttl_secs.is_some(), "JSON.SET keeps the TTL");
        for refused in ["{bad", r#"{"n":98765432109876543210}"#] {
            assert!(matches!(
                edit(&registry, &history, set(refused)).await,
                Err(AppError::Validation(_))
            ));
        }

        // prod confirms showing the command; read-only refuses
        config.environment = Environment::Prod;
        open(&registry, &config).await;
        let KeyEditResponse::NeedsConfirmation { confirmation } =
            edit(&registry, &history, set(r#"{"a": 1}"#)).await.unwrap()
        else {
            panic!("confirmation expected");
        };
        assert_eq!(confirmation.statements, [r#"JSON.SET doc $ "{\"a\": 1}""#]);
        config.environment = Environment::Local;
        config.read_only = true;
        open(&registry, &config).await;
        assert!(matches!(
            edit(&registry, &history, set("{}")).await,
            Err(AppError::ReadOnly(_))
        ));
        assert_eq!(
            output(
                console(&registry, &history, "JSON.GET doc", false)
                    .await
                    .unwrap()
            ),
            format!("{replaced:?}")
        );
    }
}
