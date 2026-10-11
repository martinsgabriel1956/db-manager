use std::time::Instant;

use redis::Value;

use crate::adapters::redis::reply;
use crate::domain::{
    AppError, CommandOutcome, CommandResponse, Confirmation, Environment, InfoSection, KeyDetail,
    KeyEdit, KeyEditRequest, KeyEditResponse, KeyPage, RedisDatabase,
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
    // server
    "PING",
    "ECHO",
    "INFO",
    "TIME",
    "LASTSAVE",
    "COMMAND",
    "CONFIG GET",
    "CLIENT LIST",
    "CLIENT INFO",
    "CLIENT GETNAME",
    "CLIENT ID",
    "SLOWLOG GET",
    "SLOWLOG LEN",
    "LATENCY LATEST",
    "ROLE",
    "LOLWUT",
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
];

/// Commands the console cannot run: they would hang or change the state of the
/// connection the whole app shares with that database.
const REFUSED_COMMANDS: &[(&str, &str)] = &[
    ("SELECT", "use a aba do database em vez de SELECT"),
    ("SUBSCRIBE", "pub/sub não é suportado no console"),
    ("PSUBSCRIBE", "pub/sub não é suportado no console"),
    ("SSUBSCRIBE", "pub/sub não é suportado no console"),
    ("UNSUBSCRIBE", "pub/sub não é suportado no console"),
    ("PUNSUBSCRIBE", "pub/sub não é suportado no console"),
    ("SUNSUBSCRIBE", "pub/sub não é suportado no console"),
    ("MONITOR", "MONITOR não é suportado no console"),
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
    if cursor.is_empty() || !cursor.bytes().all(|b| b.is_ascii_digit()) {
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
        KeyEdit::Rename { new_key } if new_key.is_empty() || new_key == key => {
            return Err(AppError::validation("informe um nome novo para a chave"));
        }
        KeyEdit::Rename { new_key } => vec!["RENAMENX", key, new_key],
        KeyEdit::Delete => vec!["DEL", key],
    };
    Ok(owned(&args))
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
                reason: PROD_REASON.to_string(),
                statements,
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
    let connection = registry.connection(connection_id)?;
    let redis = connection.redis()?;
    let args = reply::split_args(line).map_err(AppError::validation)?;
    if args.is_empty() {
        return Err(AppError::validation("nenhum comando para executar"));
    }
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
    let reason = match verdict {
        Verdict::Destructive(reason) => Some(format!("Comando destrutivo: {reason}")),
        Verdict::Write if connection.environment == Environment::Prod => {
            Some(PROD_REASON.to_string())
        }
        _ => None,
    };
    let statement = line.trim().to_string();
    if let Some(reason) = reason
        && !confirmed
    {
        return Ok(CommandResponse::NeedsConfirmation {
            confirmation: Confirmation {
                reason,
                statements: vec![statement],
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

        let invalid = [
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
    use crate::domain::{ConnectionConfig, RedisValue};
    use crate::storage::secrets::SecretStore;
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

        let entries = history.search("", Some("redis"), 50).await.unwrap();
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
}
