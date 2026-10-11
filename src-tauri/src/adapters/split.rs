//! Splits a script into statements on top-level delimiters, following each
//! dialect's lexical rules (strings, quoted identifiers, comments). Statements that
//! are only whitespace/comments are dropped.

#[derive(Debug, Clone, Copy, Default)]
pub struct SplitRules {
    /// MySQL: '\'' escapes inside strings
    pub backslash_escapes: bool,
    /// PostgreSQL: E'…' strings with backslash escapes
    pub escape_strings: bool,
    /// PostgreSQL: $$…$$ / $tag$…$tag$
    pub dollar_quotes: bool,
    /// PostgreSQL: /* /* nested */ */
    pub nested_comments: bool,
    /// MySQL: # line comments, and `--` only counts when followed by whitespace
    pub mysql_comments: bool,
    /// MySQL and SQLite: `identifier`
    pub backtick_identifiers: bool,
    /// SQLite: [identifier]
    pub bracket_identifiers: bool,
    /// MySQL client convention: `DELIMITER $$` changes the statement delimiter
    pub delimiter_command: bool,
    /// SQLite: CREATE TRIGGER … BEGIN …; …; END is one statement
    pub trigger_blocks: bool,
}

pub const POSTGRES: SplitRules = SplitRules {
    backslash_escapes: false,
    escape_strings: true,
    dollar_quotes: true,
    nested_comments: true,
    mysql_comments: false,
    backtick_identifiers: false,
    bracket_identifiers: false,
    delimiter_command: false,
    trigger_blocks: false,
};

pub const fn mysql(backslash_escapes: bool) -> SplitRules {
    SplitRules {
        backslash_escapes,
        escape_strings: false,
        dollar_quotes: false,
        nested_comments: false,
        mysql_comments: true,
        backtick_identifiers: true,
        bracket_identifiers: false,
        delimiter_command: true,
        trigger_blocks: false,
    }
}

pub const SQLITE: SplitRules = SplitRules {
    backslash_escapes: false,
    escape_strings: false,
    dollar_quotes: false,
    nested_comments: false,
    mysql_comments: false,
    backtick_identifiers: true,
    bracket_identifiers: true,
    delimiter_command: false,
    trigger_blocks: true,
};

struct Splitter<'a> {
    sql: &'a str,
    bytes: &'a [u8],
    rules: SplitRules,
    statements: Vec<String>,
    delimiter: String,
    start: usize,
    has_code: bool,
    /// first words of the current statement (trigger detection)
    words: Vec<String>,
    /// BEGIN/CASE … END nesting inside a trigger
    block_depth: usize,
}

pub fn split_statements(sql: &str, rules: SplitRules) -> Vec<String> {
    let mut splitter = Splitter {
        sql,
        bytes: sql.as_bytes(),
        rules,
        statements: Vec::new(),
        delimiter: ";".to_string(),
        start: 0,
        has_code: false,
        words: Vec::new(),
        block_depth: 0,
    };
    splitter.run();
    splitter.statements
}

impl Splitter<'_> {
    fn run(&mut self) {
        let mut i = 0;
        while i < self.bytes.len() {
            i = self.step(i);
        }
        self.finish_statement(self.bytes.len());
    }

    fn step(&mut self, i: usize) -> usize {
        let bytes = self.bytes;
        let next = bytes.get(i + 1).copied();

        if self.rules.delimiter_command && !self.has_code && self.starts_with_word(i, "DELIMITER") {
            return self.read_delimiter_command(i);
        }
        if self.block_depth == 0 && bytes[i..].starts_with(self.delimiter.as_bytes()) {
            self.finish_statement(i);
            self.start = i + self.delimiter.len();
            return self.start;
        }

        match bytes[i] {
            b'\'' => {
                let escapes = self.rules.backslash_escapes
                    || (self.rules.escape_strings && is_escape_string(bytes, i));
                self.code(skip_quoted(bytes, i, b'\'', escapes))
            }
            b'"' => self.code(skip_quoted(bytes, i, b'"', self.rules.backslash_escapes)),
            b'`' if self.rules.backtick_identifiers => {
                self.code(skip_quoted(bytes, i, b'`', false))
            }
            b'[' if self.rules.bracket_identifiers => self.code(
                bytes[i..]
                    .iter()
                    .position(|&b| b == b']')
                    .map_or(bytes.len(), |offset| i + offset + 1),
            ),
            b'-' if next == Some(b'-') && self.dash_comment(i) => skip_line_comment(bytes, i),
            b'#' if self.rules.mysql_comments => skip_line_comment(bytes, i),
            b'/' if next == Some(b'*') => skip_block_comment(bytes, i, self.rules.nested_comments),
            b'$' if self.rules.dollar_quotes => {
                let end = match dollar_tag(bytes, i) {
                    Some(tag_len) => skip_dollar_quoted(self.sql, i, tag_len),
                    None => i + 1,
                };
                self.code(end)
            }
            byte if byte.is_ascii_whitespace() => i + 1,
            byte if is_ident_byte(byte) => self.word(i),
            _ => self.code(i + 1),
        }
    }

    fn code(&mut self, next: usize) -> usize {
        self.has_code = true;
        next
    }

    fn word(&mut self, start: usize) -> usize {
        let end = self.bytes[start..]
            .iter()
            .position(|&b| !is_ident_byte(b))
            .map_or(self.bytes.len(), |offset| start + offset);
        let word = self.sql[start..end].to_ascii_uppercase();
        if self.rules.trigger_blocks {
            self.track_trigger_block(&word);
        }
        if self.words.len() < 3 {
            self.words.push(word);
        }
        self.code(end)
    }

    fn track_trigger_block(&mut self, word: &str) {
        let is_trigger = matches!(
            self.words
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .as_slice(),
            ["CREATE", "TRIGGER", ..] | ["CREATE", "TEMP" | "TEMPORARY", "TRIGGER"]
        );
        if !is_trigger {
            return;
        }
        match word {
            "BEGIN" | "CASE" => self.block_depth += 1,
            "END" => self.block_depth = self.block_depth.saturating_sub(1),
            _ => {}
        }
    }

    /// MySQL needs whitespace after `--` (so `1--1` is arithmetic); others don't.
    fn dash_comment(&self, i: usize) -> bool {
        !self.rules.mysql_comments
            || self
                .bytes
                .get(i + 2)
                .is_none_or(|b| b.is_ascii_whitespace())
    }

    fn starts_with_word(&self, i: usize, word: &str) -> bool {
        let candidate = &self.bytes[i..];
        candidate.len() > word.len()
            && candidate[..word.len()].eq_ignore_ascii_case(word.as_bytes())
            && candidate[word.len()].is_ascii_whitespace()
    }

    /// `DELIMITER $$` up to the end of the line; not a statement itself.
    fn read_delimiter_command(&mut self, i: usize) -> usize {
        let line_end = self.bytes[i..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(self.bytes.len(), |offset| i + offset);
        let delimiter = self.sql[i + "DELIMITER".len()..line_end].trim();
        if !delimiter.is_empty() {
            self.delimiter = delimiter.to_string();
        }
        self.start = line_end;
        line_end
    }

    fn finish_statement(&mut self, end: usize) {
        if self.has_code {
            self.statements
                .push(self.sql[self.start..end].trim().to_string());
        }
        self.has_code = false;
        self.words.clear();
        self.block_depth = 0;
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

fn skip_block_comment(bytes: &[u8], start: usize, nested: bool) -> usize {
    let mut depth = 0;
    let mut j = start;
    while j + 1 < bytes.len() {
        match (bytes[j], bytes[j + 1]) {
            (b'/', b'*') if nested || depth == 0 => {
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
    use super::*;

    fn check(rules: SplitRules, cases: &[(&str, &[&str])]) {
        for (input, expected) in cases {
            assert_eq!(split_statements(input, rules), *expected, "input: {input}");
        }
    }

    #[test]
    fn postgres() {
        check(
            POSTGRES,
            &[
                ("SELECT 1", &["SELECT 1"]),
                ("SELECT 1; SELECT 2;", &["SELECT 1", "SELECT 2"]),
                ("  ;; \n ; ", &[]),
                ("SELECT 'a;b'; SELECT 2", &["SELECT 'a;b'", "SELECT 2"]),
                ("SELECT 'it''s; ok'", &["SELECT 'it''s; ok'"]),
                (
                    r"SELECT E'a\';b'; SELECT 2",
                    &[r"SELECT E'a\';b'", "SELECT 2"],
                ),
                // without the E prefix a backslash is literal
                (r"SELECT 'a\'; SELECT 2", &[r"SELECT 'a\'", "SELECT 2"]),
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
                // BEGIN is a transaction here, never a block
                ("BEGIN; SELECT 1; COMMIT", &["BEGIN", "SELECT 1", "COMMIT"]),
            ],
        );
    }

    #[test]
    fn mysql_rules() {
        check(
            mysql(true),
            &[
                (
                    r"SELECT 'a\';b'; SELECT 2",
                    &[r"SELECT 'a\';b'", "SELECT 2"],
                ),
                (
                    r#"SELECT "x;\"y"; SELECT 2"#,
                    &[r#"SELECT "x;\"y""#, "SELECT 2"],
                ),
                (
                    "SELECT `we;ird` FROM t; SELECT 2",
                    &["SELECT `we;ird` FROM t", "SELECT 2"],
                ),
                (
                    "SELECT 1 # no; split\n; SELECT 2",
                    &["SELECT 1 # no; split", "SELECT 2"],
                ),
                (
                    "SELECT 1 -- no; split\n; SELECT 2",
                    &["SELECT 1 -- no; split", "SELECT 2"],
                ),
                // `--` without a following space is arithmetic, not a comment
                ("SELECT 1--1; SELECT 2", &["SELECT 1--1", "SELECT 2"]),
                (
                    "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END $$\nDELIMITER ;\nCALL p();",
                    &[
                        "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
                        "CALL p()",
                    ],
                ),
            ],
        );
        // NO_BACKSLASH_ESCAPES: a backslash is just a character
        check(
            mysql(false),
            &[(r"SELECT 'a\'; SELECT 2", &[r"SELECT 'a\'", "SELECT 2"])],
        );
    }

    #[test]
    fn sqlite_rules() {
        check(
            SQLITE,
            &[
                (
                    "SELECT [we;ird] FROM t; SELECT 2",
                    &["SELECT [we;ird] FROM t", "SELECT 2"],
                ),
                ("SELECT `a;b`; SELECT 2", &["SELECT `a;b`", "SELECT 2"]),
                (
                    "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; INSERT INTO c VALUES (CASE WHEN 1 THEN 2 END); END; SELECT 1",
                    &[
                        "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; INSERT INTO c VALUES (CASE WHEN 1 THEN 2 END); END",
                        "SELECT 1",
                    ],
                ),
                (
                    "CREATE TEMP TRIGGER t AFTER DELETE ON a BEGIN DELETE FROM b; END; SELECT 2",
                    &[
                        "CREATE TEMP TRIGGER t AFTER DELETE ON a BEGIN DELETE FROM b; END",
                        "SELECT 2",
                    ],
                ),
                // outside a trigger, BEGIN is a transaction
                (
                    "BEGIN; INSERT INTO a VALUES (1); COMMIT",
                    &["BEGIN", "INSERT INTO a VALUES (1)", "COMMIT"],
                ),
                // SQLite block comments do not nest
                (
                    "SELECT /* a /* b */ 1; SELECT 2",
                    &["SELECT /* a /* b */ 1", "SELECT 2"],
                ),
            ],
        );
    }
}
