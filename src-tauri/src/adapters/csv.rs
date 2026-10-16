//! CSV in the PostgreSQL `COPY … CSV` flavour: NULL is an empty unquoted field and
//! an empty string is `""`, so the two survive a round trip.

use std::io::{self, BufRead, Write};

use crate::domain::{AppError, Cell};

pub fn write_header(out: &mut impl Write, names: &[String]) -> io::Result<()> {
    let fields: Vec<String> = names.iter().map(|name| quote(name)).collect();
    writeln!(out, "{}", fields.join(","))
}

pub fn write_row(out: &mut impl Write, row: &[Cell]) -> io::Result<()> {
    let fields: Vec<String> = row
        .iter()
        .map(|cell| text(cell).map(|text| quote(&text)).unwrap_or_default())
        .collect();
    writeln!(out, "{}", fields.join(","))
}

fn quote(text: &str) -> String {
    if text.is_empty() || text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

/// The value as text; None for NULL.
fn text(cell: &Cell) -> Option<String> {
    Some(match cell {
        Cell::Null => return None,
        Cell::Bool(value) => value.to_string(),
        Cell::Float(value) => value.to_string(),
        Cell::Int(text)
        | Cell::Decimal(text)
        | Cell::Text(text)
        | Cell::Date(text)
        | Cell::Json(text)
        | Cell::Unknown { text, .. }
        // the text already carries the offset; `tz` only names the zone
        | Cell::Timestamp { value: text, .. } => text.clone(),
        // ponytail: the grid only carries a 32-byte preview; bigger blobs export as a
        // placeholder until cell conversion gets a "full bytes" mode
        Cell::Bytes { len, preview_hex } if preview_hex.len() == *len as usize * 2 => {
            format!("\\x{preview_hex}")
        }
        Cell::Bytes { len, .. } => format!("<{len} bytes>"),
        // ponytail: PostgreSQL-style {a,b} without quoting elements that contain commas
        Cell::Array(items) => {
            let items: Vec<String> = items
                .iter()
                .map(|item| text(item).unwrap_or_else(|| "NULL".to_string()))
                .collect();
            format!("{{{}}}", items.join(","))
        }
    })
}

/// A record read back: the line it starts on (the header is line 1) and its fields,
/// `None` for an empty unquoted field (NULL), `Some("")` for `""`.
#[derive(Debug, PartialEq, Eq)]
pub struct Record {
    pub line: u64,
    pub fields: Vec<Option<String>>,
}

/// Reads one record at a time, so a file of any size streams. The separator is
/// guessed from the header line: `,`, `;` (spreadsheets in pt-BR save that) or tab.
pub struct Reader<R> {
    input: R,
    delimiter: char,
    /// lines read so far
    line: u64,
    width: usize,
}

impl<R: BufRead> Reader<R> {
    /// Reads the header: every record must have as many fields.
    pub fn new(mut input: R) -> Result<(Self, Vec<String>), AppError> {
        let mut first = String::new();
        read_line(&mut input, &mut first, 1)?;
        let first = first.strip_prefix('\u{feff}').unwrap_or(&first).to_string();
        if split_ending(&first).0.is_empty() {
            return Err(AppError::validation(
                "o arquivo não tem cabeçalho na primeira linha",
            ));
        }
        let delimiter = [',', ';', '\t']
            .into_iter()
            // ties go to the comma: max_by_key keeps the last of equal keys
            .rev()
            .max_by_key(|candidate| first.matches(*candidate).count())
            .unwrap_or(',');
        let mut reader = Reader {
            input,
            delimiter,
            line: 0,
            width: 0,
        };
        let header: Vec<String> = reader
            .parse(first)?
            .fields
            .into_iter()
            .map(Option::unwrap_or_default)
            .collect();
        reader.width = header.len();
        Ok((reader, header))
    }

    pub fn delimiter(&self) -> char {
        self.delimiter
    }

    /// The next record; blank lines are skipped.
    pub fn next_record(&mut self) -> Result<Option<Record>, AppError> {
        loop {
            let mut text = String::new();
            if read_line(&mut self.input, &mut text, self.line + 1)? == 0 {
                return Ok(None);
            }
            // ponytail: a blank line is skipped, so a one-column file cannot hold a NULL
            // row there (COPY reads it as one); a quoted "" still imports
            if split_ending(&text).0.is_empty() {
                self.line += 1;
                continue;
            }
            let record = self.parse(text)?;
            if record.fields.len() != self.width {
                return Err(AppError::validation(format!(
                    "linha {}: {} campos, mas o cabeçalho tem {}",
                    record.line,
                    record.fields.len(),
                    self.width
                )));
            }
            return Ok(Some(record));
        }
    }

    /// One record starting at `text`, reading more lines while a quoted field spans them.
    fn parse(&mut self, mut text: String) -> Result<Record, AppError> {
        self.line += 1;
        let start = self.line;
        let mut fields = Vec::new();
        let mut field = String::new();
        let mut quoted = false;
        let mut in_quotes = false;
        loop {
            let (body, ending) = split_ending(&text);
            let mut chars = body.chars().peekable();
            while let Some(c) = chars.next() {
                if in_quotes {
                    match c {
                        '"' if chars.peek() == Some(&'"') => {
                            chars.next();
                            field.push('"');
                        }
                        '"' => in_quotes = false,
                        c => field.push(c),
                    }
                } else if c == self.delimiter {
                    fields.push(take(&mut field, &mut quoted));
                } else if quoted {
                    return Err(AppError::validation(format!(
                        "linha {}: texto depois das aspas que fecham o campo {}",
                        self.line,
                        fields.len() + 1
                    )));
                } else if c == '"' && field.is_empty() {
                    quoted = true;
                    in_quotes = true;
                } else {
                    // a quote inside an unquoted field is plain text, as in 5" disk
                    field.push(c);
                }
            }
            if !in_quotes {
                fields.push(take(&mut field, &mut quoted));
                return Ok(Record {
                    line: start,
                    fields,
                });
            }
            // the line break belongs to the quoted value, exactly as written
            field.push_str(ending);
            text.clear();
            if read_line(&mut self.input, &mut text, self.line + 1)? == 0 {
                return Err(AppError::validation(format!(
                    "linha {start}: aspas abertas que não fecham até o fim do arquivo"
                )));
            }
            self.line += 1;
        }
    }
}

fn take(field: &mut String, quoted: &mut bool) -> Option<String> {
    let value = std::mem::take(field);
    let was_quoted = std::mem::replace(quoted, false);
    (was_quoted || !value.is_empty()).then_some(value)
}

/// The line without its terminator, and the terminator (`\n`, `\r\n` or nothing at the end).
fn split_ending(text: &str) -> (&str, &str) {
    let body = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);
    (body, &text[body.len()..])
}

fn read_line(input: &mut impl BufRead, buf: &mut String, line: u64) -> Result<usize, AppError> {
    input.read_line(buf).map_err(|err| match err.kind() {
        io::ErrorKind::InvalidData => {
            AppError::validation(format!("linha {line}: o arquivo não está em UTF-8"))
        }
        _ => err.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_all(text: &str) -> Result<(Vec<String>, Vec<Record>), AppError> {
        let (mut reader, header) = Reader::new(text.as_bytes())?;
        let mut records = Vec::new();
        while let Some(record) = reader.next_record()? {
            records.push(record);
        }
        Ok((header, records))
    }

    fn some(text: &str) -> Option<String> {
        Some(text.to_string())
    }

    #[test]
    fn reads_back_what_the_export_writes() {
        let mut out = Vec::new();
        write_header(&mut out, &["id".into(), "a,b".into()]).unwrap();
        for row in [
            [Cell::Int("1".into()), Cell::Null],
            [Cell::Int("2".into()), Cell::Text(String::new())],
            [
                Cell::Int("3".into()),
                Cell::Text("say \"hi\"\r\nbye, ok".into()),
            ],
        ] {
            write_row(&mut out, &row).unwrap();
        }
        let (header, records) = read_all(std::str::from_utf8(&out).unwrap()).unwrap();
        assert_eq!(header, ["id", "a,b"]);
        assert_eq!(
            records,
            [
                Record {
                    line: 2,
                    fields: vec![some("1"), None]
                },
                Record {
                    line: 3,
                    fields: vec![some("2"), some("")]
                },
                Record {
                    line: 4,
                    fields: vec![some("3"), some("say \"hi\"\r\nbye, ok")]
                },
            ]
        );
    }

    #[test]
    fn guesses_the_separator_and_skips_bom_crlf_and_blank_lines() {
        let (mut reader, header) =
            Reader::new("\u{feff}nome;cidade\r\nAna;São Paulo\r\n\r\nBia;\r\n".as_bytes()).unwrap();
        assert_eq!(reader.delimiter(), ';');
        assert_eq!(header, ["nome", "cidade"]);
        assert_eq!(
            reader.next_record().unwrap().unwrap().fields,
            [some("Ana"), some("São Paulo")]
        );
        let last = reader.next_record().unwrap().unwrap();
        assert_eq!((last.line, last.fields), (4, vec![some("Bia"), None]));
        assert_eq!(reader.next_record().unwrap(), None);

        let (reader, _) = Reader::new("a\tb\n".as_bytes()).unwrap();
        assert_eq!(reader.delimiter(), '\t');
        let (reader, header) = Reader::new("solo".as_bytes()).unwrap();
        assert_eq!(
            (reader.delimiter(), header),
            (',', vec!["solo".to_string()])
        );
    }

    #[test]
    fn says_which_line_is_wrong() {
        let error = |text: &str| read_all(text).unwrap_err().to_string();
        assert_eq!(
            error("a,b\n1,2\n3\n"),
            "linha 3: 1 campos, mas o cabeçalho tem 2"
        );
        assert_eq!(
            error("a,b\n1,\"x\ny\n"),
            "linha 2: aspas abertas que não fecham até o fim do arquivo"
        );
        assert_eq!(
            error("a,b\n\"x\ny\"z,1\n"),
            "linha 3: texto depois das aspas que fecham o campo 1"
        );
        assert_eq!(error(""), "o arquivo não tem cabeçalho na primeira linha");
        let latin1: &[u8] = b"a\nS\xe3o\n";
        let (mut reader, _) = Reader::new(latin1).unwrap();
        assert_eq!(
            reader.next_record().unwrap_err().to_string(),
            "linha 2: o arquivo não está em UTF-8"
        );
        // a quote inside an unquoted field is text
        let (_, records) = read_all("a\n5\" disk\n").unwrap();
        assert_eq!(records[0].fields, [some("5\" disk")]);
    }

    fn row(cells: &[Cell]) -> String {
        let mut out = Vec::new();
        write_row(&mut out, cells).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn null_and_empty_string_differ_and_specials_are_quoted() {
        assert_eq!(
            row(&[
                Cell::Null,
                Cell::Text(String::new()),
                Cell::Text("a,b".into()),
                Cell::Text("say \"hi\"\nbye".into()),
                Cell::Int("9007199254740993".into()),
                Cell::Bool(true),
            ]),
            ",\"\",\"a,b\",\"say \"\"hi\"\"\nbye\",9007199254740993,true\n"
        );
    }

    #[test]
    fn typed_values_keep_their_text() {
        assert_eq!(
            row(&[
                Cell::Timestamp {
                    value: "2026-01-02 03:04:05+00".into(),
                    tz: Some("UTC".into())
                },
                Cell::Bytes {
                    len: 2,
                    preview_hex: "00ff".into()
                },
                Cell::Bytes {
                    len: 100,
                    preview_hex: "00".repeat(32)
                },
                Cell::Array(vec![Cell::Int("1".into()), Cell::Null]),
                Cell::Float(1.5),
            ]),
            "2026-01-02 03:04:05+00,\\x00ff,<100 bytes>,\"{1,NULL}\",1.5\n"
        );
    }

    #[test]
    fn header_is_quoted_too() {
        let mut out = Vec::new();
        write_header(&mut out, &["id".into(), "full name".into(), "a,b".into()]).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "id,full name,\"a,b\"\n");
    }
}
