//! Splits a script into statements on top-level `;`, following PostgreSQL lexical rules:
//! '...' ('' escape), E'...' (backslash escapes), "...", $tag$...$tag$,
//! -- line comments and nested /* */ comments. Statements that are only
//! whitespace/comments are dropped.

pub fn split_statements(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let mut has_code = false;

    while i < bytes.len() {
        let next = bytes.get(i + 1).copied();
        match bytes[i] {
            b'\'' => {
                i = skip_quoted(bytes, i, b'\'', is_escape_string(bytes, i));
                has_code = true;
            }
            b'"' => {
                i = skip_quoted(bytes, i, b'"', false);
                has_code = true;
            }
            b'-' if next == Some(b'-') => i = skip_line_comment(bytes, i),
            b'/' if next == Some(b'*') => i = skip_block_comment(bytes, i),
            b'$' => {
                i = match dollar_tag(bytes, i) {
                    Some(tag) => skip_dollar_quoted(sql, i, tag),
                    None => i + 1,
                };
                has_code = true;
            }
            b';' => {
                push_statement(&mut statements, &sql[start..i], has_code);
                start = i + 1;
                has_code = false;
                i += 1;
            }
            byte if byte.is_ascii_whitespace() => i += 1,
            _ => {
                has_code = true;
                i += 1;
            }
        }
    }
    push_statement(&mut statements, &sql[start..], has_code);
    statements
}

fn push_statement(statements: &mut Vec<String>, text: &str, has_code: bool) {
    if has_code {
        statements.push(text.trim().to_string());
    }
}

/// E'...' or e'...' where the E is not the tail of an identifier.
fn is_escape_string(bytes: &[u8], quote: usize) -> bool {
    if quote == 0 || !matches!(bytes[quote - 1], b'E' | b'e') {
        return false;
    }
    quote == 1 || !is_ident_byte(bytes[quote - 2])
}

fn is_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 0x80
}

/// Returns the index right after the closing quote (or the end on unterminated input).
fn skip_quoted(bytes: &[u8], open: usize, quote: u8, backslash_escapes: bool) -> usize {
    let mut j = open + 1;
    while j < bytes.len() {
        if backslash_escapes && bytes[j] == b'\\' {
            j += 2;
        } else if bytes[j] == quote {
            if bytes.get(j + 1) == Some(&quote) {
                j += 2;
            } else {
                return j + 1;
            }
        } else {
            j += 1;
        }
    }
    bytes.len()
}

fn skip_line_comment(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |offset| start + offset + 1)
}

fn skip_block_comment(bytes: &[u8], start: usize) -> usize {
    let mut depth = 0;
    let mut j = start;
    while j + 1 < bytes.len() {
        match (bytes[j], bytes[j + 1]) {
            (b'/', b'*') => {
                depth += 1;
                j += 2;
            }
            (b'*', b'/') => {
                depth -= 1;
                j += 2;
                if depth == 0 {
                    return j;
                }
            }
            _ => j += 1,
        }
    }
    bytes.len()
}

/// `$$` or `$tag$` starting at `start`; `$1` (a parameter) is not a tag.
fn dollar_tag(bytes: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    if bytes.get(j).is_some_and(|b| b.is_ascii_digit()) {
        return None;
    }
    while j < bytes.len() && is_ident_byte(bytes[j]) {
        j += 1;
    }
    (bytes.get(j) == Some(&b'$')).then_some(j + 1 - start)
}

fn skip_dollar_quoted(sql: &str, start: usize, tag_len: usize) -> usize {
    let tag = &sql[start..start + tag_len];
    let body = start + tag_len;
    sql[body..]
        .find(tag)
        .map_or(sql.len(), |offset| body + offset + tag_len)
}

#[cfg(test)]
mod tests {
    use super::split_statements;

    #[test]
    fn splits_cases() {
        let cases: &[(&str, &[&str])] = &[
            ("SELECT 1", &["SELECT 1"]),
            ("SELECT 1; SELECT 2;", &["SELECT 1", "SELECT 2"]),
            ("  ;; \n ; ", &[]),
            ("SELECT 'a;b'; SELECT 2", &["SELECT 'a;b'", "SELECT 2"]),
            ("SELECT 'it''s; ok'", &["SELECT 'it''s; ok'"]),
            (
                r"SELECT E'a\';b'; SELECT 2",
                &[r"SELECT E'a\';b'", "SELECT 2"],
            ),
            // without the E prefix a backslash is literal, so the string ends at the 2nd quote
            (r"SELECT 'a\'; SELECT 2", &[r"SELECT 'a\'", "SELECT 2"]),
            // `type'...'` is not an escape string: E is the tail of an identifier
            (
                r"SELECT typE'a\'; SELECT 2",
                &[r"SELECT typE'a\'", "SELECT 2"],
            ),
            (
                r#"SELECT "we;ird""col" FROM t"#,
                &[r#"SELECT "we;ird""col" FROM t"#],
            ),
            (
                "SELECT 1 -- no; split\n; SELECT 2",
                &["SELECT 1 -- no; split", "SELECT 2"],
            ),
            (
                "SELECT /* a; /* nested; */ b; */ 1",
                &["SELECT /* a; /* nested; */ b; */ 1"],
            ),
            (
                "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql; SELECT f()",
                &[
                    "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql",
                    "SELECT f()",
                ],
            ),
            (
                "SELECT $fn$ a; $$ b; $fn$; SELECT 2",
                &["SELECT $fn$ a; $$ b; $fn$", "SELECT 2"],
            ),
            ("SELECT $1; SELECT 2", &["SELECT $1", "SELECT 2"]),
            ("-- only a comment\n/* and another */", &[]),
            ("SELECT 1; -- trailing comment", &["SELECT 1"]),
            (
                "SELECT 'unterminated; SELECT 2",
                &["SELECT 'unterminated; SELECT 2"],
            ),
            (
                "SELECT 'olá; mundo'; SELECT 'ç'",
                &["SELECT 'olá; mundo'", "SELECT 'ç'"],
            ),
        ];

        for (input, expected) in cases {
            assert_eq!(split_statements(input), *expected, "input: {input}");
        }
    }
}
