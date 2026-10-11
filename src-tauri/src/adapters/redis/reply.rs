//! Text forms of Redis data, following redis-cli: escaped strings, numbered
//! replies, and the quoting rules of its command line.

use std::fmt::Write;

use redis::Value;

use crate::domain::RedisText;

/// UTF-8 is shown as is (escaping only quotes, backslashes and control characters);
/// anything else byte by byte, like redis-cli (`\xff`).
pub fn text(bytes: &[u8]) -> RedisText {
    match std::str::from_utf8(bytes) {
        Ok(text) => RedisText {
            text: text.to_string(),
            binary: false,
        },
        Err(_) => RedisText {
            text: escape(bytes),
            binary: true,
        },
    }
}

/// Escaped form without the surrounding quotes.
fn escape(bytes: &[u8]) -> String {
    let mut out = String::new();
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            for c in text.chars() {
                match c {
                    c if c.is_control() && c.is_ascii() => escape_byte(&mut out, c as u8),
                    '"' | '\\' => {
                        out.push('\\');
                        out.push(c);
                    }
                    c => out.push(c),
                }
            }
        }
        Err(_) => {
            for &byte in bytes {
                match byte {
                    b'"' | b'\\' => {
                        out.push('\\');
                        out.push(byte as char);
                    }
                    0x20..=0x7e => out.push(byte as char),
                    _ => escape_byte(&mut out, byte),
                }
            }
        }
    }
    out
}

fn escape_byte(out: &mut String, byte: u8) {
    match byte {
        b'\n' => out.push_str("\\n"),
        b'\r' => out.push_str("\\r"),
        b'\t' => out.push_str("\\t"),
        0x07 => out.push_str("\\a"),
        0x08 => out.push_str("\\b"),
        _ => {
            let _ = write!(out, "\\x{byte:02x}");
        }
    }
}

fn quoted(bytes: &[u8]) -> String {
    format!("\"{}\"", escape(bytes))
}

/// A command as it would be typed in redis-cli: bare words when safe, quoted otherwise.
pub fn command_line(args: &[&str]) -> String {
    args.iter()
        .map(|arg| {
            let bare = !arg.is_empty()
                && arg
                    .chars()
                    .all(|c| !c.is_whitespace() && !c.is_control() && !"\"'\\".contains(c));
            if bare {
                (*arg).to_string()
            } else {
                quoted(arg.as_bytes())
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A reply as redis-cli prints it. A top-level multi-line text (INFO, CLIENT LIST)
/// is printed raw instead of as one escaped line.
pub fn format_reply(value: &Value) -> String {
    let raw = match value {
        Value::BulkString(bytes) => std::str::from_utf8(bytes).ok(),
        Value::VerbatimString { text, .. } => Some(text.as_str()),
        _ => None,
    };
    if let Some(text) = raw.filter(|text| text.contains('\n')) {
        return text.replace("\r\n", "\n").trim_end().to_string();
    }
    let mut out = String::new();
    write_value(&mut out, value, 0);
    out
}

fn write_value(out: &mut String, value: &Value, indent: usize) {
    match value {
        Value::Nil => out.push_str("(nil)"),
        Value::Int(number) => {
            let _ = write!(out, "(integer) {number}");
        }
        Value::BulkString(bytes) => out.push_str(&quoted(bytes)),
        Value::SimpleString(text) => out.push_str(text),
        Value::Okay => out.push_str("OK"),
        Value::Double(number) => {
            let _ = write!(out, "(double) {number}");
        }
        Value::Boolean(flag) => {
            let _ = write!(out, "({flag})");
        }
        Value::VerbatimString { text, .. } => out.push_str(&quoted(text.as_bytes())),
        Value::BigNumber(digits) => {
            let _ = write!(out, "(big number) {}", String::from_utf8_lossy(digits));
        }
        Value::ServerError(err) => {
            let _ = write!(out, "(error) {err}");
        }
        Value::Array(items) | Value::Set(items) | Value::Push { data: items, .. } => {
            write_list(out, items.iter(), indent);
        }
        Value::Map(pairs) => {
            let flat: Vec<&Value> = pairs.iter().flat_map(|(k, v)| [k, v]).collect();
            write_list(out, flat.into_iter(), indent);
        }
        Value::Attribute { data, .. } => write_value(out, data, indent),
        // Value is non-exhaustive
        other => {
            let _ = write!(out, "{other:?}");
        }
    }
}

/// `1) …` lines; nested lists continue on the same line, aligned under their parent.
fn write_list<'a>(
    out: &mut String,
    items: impl ExactSizeIterator<Item = &'a Value>,
    indent: usize,
) {
    let count = items.len();
    if count == 0 {
        out.push_str("(empty array)");
        return;
    }
    let width = count.to_string().len();
    for (position, item) in items.enumerate() {
        if position > 0 {
            out.push('\n');
            out.push_str(&" ".repeat(indent));
        }
        let label = format!("{:>width$}) ", position + 1);
        out.push_str(&label);
        write_value(out, item, indent + label.len());
    }
}

/// Splits a command line like redis-cli: whitespace-separated words, "double quotes"
/// with escapes (\n, \t, \xHH, …) and 'single quotes' (only \' escaped).
pub fn split_args(line: &str) -> Result<Vec<Vec<u8>>, String> {
    let mut args = Vec::new();
    let mut chars = line.chars().peekable();
    loop {
        while chars.next_if(|c| c.is_whitespace()).is_some() {}
        let Some(&first) = chars.peek() else {
            return Ok(args);
        };
        let mut arg = Vec::new();
        if first == '"' || first == '\'' {
            chars.next();
            loop {
                let c = chars
                    .next()
                    .ok_or_else(|| "aspas sem fechamento".to_string())?;
                match c {
                    c if c == first => break,
                    '\\' if first == '"' => {
                        let escaped = chars
                            .next()
                            .ok_or_else(|| "aspas sem fechamento".to_string())?;
                        match escaped {
                            'n' => arg.push(b'\n'),
                            'r' => arg.push(b'\r'),
                            't' => arg.push(b'\t'),
                            'b' => arg.push(0x08),
                            'a' => arg.push(0x07),
                            'x' => {
                                let hex: String = chars.by_ref().take(2).collect();
                                match u8::from_str_radix(&hex, 16) {
                                    Ok(byte) if hex.len() == 2 => arg.push(byte),
                                    _ => return Err(format!("escape inválido: \\x{hex}")),
                                }
                            }
                            other => push_char(&mut arg, other),
                        }
                    }
                    '\\' if chars.peek() == Some(&'\'') => {
                        chars.next();
                        arg.push(b'\'');
                    }
                    c => push_char(&mut arg, c),
                }
            }
            if chars.peek().is_some_and(|c| !c.is_whitespace()) {
                return Err("as aspas de fechamento devem ser seguidas de espaço".to_string());
            }
        } else {
            while let Some(c) = chars.next_if(|c| !c.is_whitespace()) {
                push_char(&mut arg, c);
            }
        }
        args.push(arg);
    }
}

fn push_char(arg: &mut Vec<u8>, c: char) {
    let mut buffer = [0; 4];
    arg.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bulk(text: &str) -> Value {
        Value::BulkString(text.as_bytes().to_vec())
    }

    #[test]
    fn texts_keep_utf8_and_escape_binary() {
        assert_eq!(
            text("São Paulo".as_bytes()),
            RedisText {
                text: "São Paulo".into(),
                binary: false
            }
        );
        assert_eq!(
            text(&[0xff, b'a', b'"', 0x00]),
            RedisText {
                text: r#"\xffa\"\x00"#.into(),
                binary: true
            }
        );
    }

    #[test]
    fn replies_print_like_redis_cli() {
        assert_eq!(format_reply(&Value::Nil), "(nil)");
        assert_eq!(format_reply(&Value::Int(-3)), "(integer) -3");
        assert_eq!(format_reply(&Value::Okay), "OK");
        assert_eq!(format_reply(&bulk("a\"b")), r#""a\"b""#);
        assert_eq!(format_reply(&Value::Array(vec![])), "(empty array)");

        let nested = Value::Array(vec![
            bulk("a"),
            Value::Array(vec![bulk("b"), Value::Int(1)]),
            Value::Nil,
        ]);
        assert_eq!(
            format_reply(&nested),
            "1) \"a\"\n2) 1) \"b\"\n   2) (integer) 1\n3) (nil)"
        );

        // ten items: labels right-aligned, nested lines indented past the label
        let mut items: Vec<Value> = (1..=9).map(Value::Int).collect();
        items.push(Value::Array(vec![bulk("x"), bulk("y")]));
        let printed = format_reply(&Value::Array(items));
        assert!(printed.starts_with(" 1) (integer) 1\n"));
        assert!(printed.ends_with("10) 1) \"x\"\n    2) \"y\""));
    }

    #[test]
    fn multi_line_text_prints_raw() {
        assert_eq!(
            format_reply(&bulk("# Server\r\nredis_version:7.4.0\r\n")),
            "# Server\nredis_version:7.4.0"
        );
        // inside an array it stays escaped
        assert_eq!(
            format_reply(&Value::Array(vec![bulk("a\nb")])),
            r#"1) "a\nb""#
        );
    }

    #[test]
    fn command_lines_quote_only_when_needed() {
        assert_eq!(
            command_line(&["HSET", "user:1", "name", "Ana Maria", "", "a\"b"]),
            r#"HSET user:1 name "Ana Maria" "" "a\"b""#
        );
    }

    #[test]
    fn arguments_split_like_redis_cli() {
        let args = |line: &str| -> Vec<String> {
            split_args(line)
                .unwrap()
                .into_iter()
                .map(|arg| String::from_utf8_lossy(&arg).into_owned())
                .collect()
        };
        assert_eq!(
            args(r#"  SET  "my key" 'it\'s'  "a\tb\x41" ção "#),
            ["SET", "my key", "it's", "a\tbA", "ção"]
        );
        assert_eq!(args(r#"SET k """#), ["SET", "k", ""]);
        assert!(args("   ").is_empty());
        assert_eq!(split_args(r#"SET "\xff""#).unwrap()[1], vec![0xff]);

        assert!(split_args(r#"SET "open"#).is_err());
        assert!(split_args(r#"SET "a"b"#).is_err());
        assert!(split_args(r#"SET "\xzz""#).is_err());
    }
}
