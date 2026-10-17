//! `CLIENT LIST` and `SLOWLOG GET` replies, as the sessions screen shows them.

use redis::Value;

use crate::domain::{SessionInfo, SlowCommand};

/// One line per client, `field=value` separated by spaces (no value has a space:
/// CLIENT SETNAME refuses them). `own` is this connection's `CLIENT ID`.
pub fn parse_client_list(text: &str, own: i64) -> Vec<SessionInfo> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let field = |name: &str| {
                line.split(' ')
                    .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            };
            let id = field("id").unwrap_or_default();
            let client = match (field("addr"), field("name")) {
                (Some(addr), Some(name)) => Some(format!("{addr} · {name}")),
                (addr, name) => addr.or(name),
            };
            SessionInfo {
                own: id.parse::<i64>().is_ok_and(|id| id == own),
                id,
                user: field("user"),
                database: field("db"),
                state: field("flags"),
                seconds: field("idle").and_then(|idle| idle.parse().ok()),
                client,
                query: field("cmd"),
            }
        })
        .collect()
}

/// `[id, unix time, microseconds, [args…], client addr, client name]` per entry; the
/// two client fields exist since Redis 4.
pub fn parse_slowlog(reply: &Value) -> Vec<SlowCommand> {
    let Value::Array(entries) = reply else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let Value::Array(fields) = entry else {
                return None;
            };
            let number = |index: usize| match fields.get(index) {
                Some(Value::Int(value)) => Some(*value),
                _ => None,
            };
            let text = |value: &Value| match value {
                Value::BulkString(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
                Value::SimpleString(text) => Some(text.clone()),
                _ => None,
            };
            let command = match fields.get(3) {
                Some(Value::Array(args)) => args.iter().filter_map(text).collect::<Vec<_>>(),
                _ => Vec::new(),
            };
            let client = fields.get(4).and_then(text).filter(|addr| !addr.is_empty());
            Some(SlowCommand {
                id: number(0)?.to_string(),
                started_at: u32::try_from(number(1)?).unwrap_or(u32::MAX),
                duration_us: u32::try_from(number(2)?).unwrap_or(u32::MAX),
                command: command.join(" "),
                client,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_list_marks_the_listing_connection() {
        let text = "id=3 addr=127.0.0.1:52555 laddr=127.0.0.1:6379 fd=8 name= age=9 idle=2 flags=N db=0 cmd=client|list user=default\n\
                    id=7 addr=10.0.0.2:4000 fd=9 name=worker age=100 idle=50 flags=b db=2 cmd=blpop user=app\n";
        let sessions = parse_client_list(text, 3);
        assert_eq!(sessions.len(), 2);
        assert_eq!(
            sessions[0],
            SessionInfo {
                id: "3".into(),
                user: Some("default".into()),
                database: Some("0".into()),
                state: Some("N".into()),
                seconds: Some(2),
                client: Some("127.0.0.1:52555".into()),
                query: Some("client|list".into()),
                own: true,
            }
        );
        assert!(!sessions[1].own);
        assert_eq!(
            sessions[1].client.as_deref(),
            Some("10.0.0.2:4000 · worker")
        );
        // "laddr=" must not be read as "addr="
        assert_eq!(parse_client_list("laddr=x id=1", 0)[0].client, None);
    }

    #[test]
    fn slowlog_entries_keep_the_command_words() {
        let bulk = |text: &str| Value::BulkString(text.as_bytes().to_vec());
        let reply = Value::Array(vec![
            Value::Array(vec![
                Value::Int(14),
                Value::Int(1_700_000_000),
                Value::Int(15_000),
                Value::Array(vec![bulk("KEYS"), bulk("*")]),
                bulk("127.0.0.1:5000"),
                bulk(""),
            ]),
            // Redis 3: no client fields
            Value::Array(vec![
                Value::Int(13),
                Value::Int(1_600_000_000),
                Value::Int(20),
                Value::Array(vec![bulk("GET"), bulk("a")]),
            ]),
            Value::Nil,
        ]);
        let entries = parse_slowlog(&reply);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].command, "KEYS *");
        assert_eq!(entries[0].duration_us, 15_000);
        assert_eq!(entries[0].client.as_deref(), Some("127.0.0.1:5000"));
        assert_eq!(entries[1].client, None);
        assert!(parse_slowlog(&Value::Nil).is_empty());
    }
}
