//! Documents travel to the UI as Extended JSON text and come back the same way, so an
//! edit never turns an ObjectId into a string or a Long into an Int.
//!
//! Format: relaxed Extended JSON v2 (ObjectId, Date, Decimal128, Binary… keep their
//! `$` wrappers), except Int64, which is always `{"$numberLong": "…"}`. Relaxed mode
//! prints Int64 as a bare number, which would come back as Int32 when small and lose
//! precision in JavaScript when big. With that rule a bare integer is an Int32 and a
//! number with a decimal point is a Double, both safe for `JSON.parse`.

use std::io::BufRead;

use mongodb::bson::{Bson, Document};
use serde_json::{Value, json};

use crate::domain::AppError;

pub fn to_text(document: Document) -> String {
    to_json(Bson::Document(document)).to_string()
}

pub fn value_to_text(value: Bson) -> String {
    to_json(value).to_string()
}

fn to_json(value: Bson) -> Value {
    match value {
        Bson::Int64(number) => json!({ "$numberLong": number.to_string() }),
        Bson::Document(document) => Value::Object(
            document
                .into_iter()
                .map(|(key, value)| (key, to_json(value)))
                .collect(),
        ),
        Bson::Array(items) => Value::Array(items.into_iter().map(to_json).collect()),
        other => other.into_relaxed_extjson(),
    }
}

/// A document typed by the user; an empty text is an empty document (`{}`).
pub fn parse_document(text: &str, what: &str) -> Result<Document, AppError> {
    if text.trim().is_empty() {
        return Ok(Document::new());
    }
    match parse_value(text, what)? {
        Bson::Document(document) => Ok(document),
        _ => Err(AppError::validation(format!(
            "{what}: esperado um objeto JSON"
        ))),
    }
}

pub fn parse_pipeline(text: &str) -> Result<Vec<Document>, AppError> {
    match parse_value(text, "pipeline")? {
        Bson::Array(stages) => stages
            .into_iter()
            .map(|stage| match stage {
                Bson::Document(document) => Ok(document),
                _ => Err(AppError::validation(
                    "pipeline: cada estágio deve ser um objeto",
                )),
            })
            .collect(),
        _ => Err(AppError::validation(
            "pipeline: esperado um array de estágios",
        )),
    }
}

pub fn parse_value(text: &str, what: &str) -> Result<Bson, AppError> {
    let json: Value = serde_json::from_str(text)
        .map_err(|err| AppError::validation(format!("{what}: JSON inválido ({err})")))?;
    Bson::try_from(json)
        .map_err(|err| AppError::validation(format!("{what}: Extended JSON inválido ({err})")))
}

/// Reads documents one at a time from NDJSON (one per line) or a JSON array, so a
/// file of any size streams. Each document's text is handed over as written, to be
/// parsed by `parse_document`: Extended JSON wrappers keep their types.
pub struct DocumentReader<R> {
    input: R,
    /// lines read so far, for errors
    line: u64,
    /// the file is one `[…]` array; `None` until the first value is seen
    array: Option<bool>,
    closed: bool,
}

impl<R: BufRead> DocumentReader<R> {
    pub fn new(input: R) -> Self {
        DocumentReader {
            input,
            line: 1,
            array: None,
            closed: false,
        }
    }

    /// The next document's line (where it starts) and text.
    pub fn next_document(&mut self) -> Result<Option<(u64, String)>, AppError> {
        // between documents: whitespace, and in an array `[`, `,` and `]`
        loop {
            let Some(byte) = self.peek()? else {
                return match self.array {
                    Some(true) if !self.closed => Err(AppError::validation(format!(
                        "linha {}: o array JSON não fecha com ]",
                        self.line
                    ))),
                    _ => Ok(None),
                };
            };
            match byte {
                b'\n' => self.line += 1,
                b' ' | b'\t' | b'\r' => {}
                b'[' if self.array.is_none() => self.array = Some(true),
                b',' if self.array == Some(true) && !self.closed => {}
                b']' if self.array == Some(true) && !self.closed => self.closed = true,
                b'{' if !self.closed => break,
                _ => {
                    return Err(AppError::validation(format!(
                        "linha {}: esperado um documento JSON ({{…}})",
                        self.line
                    )));
                }
            }
            self.input.consume(1);
        }
        self.array.get_or_insert(false);

        let start = self.line;
        let mut text = Vec::new();
        let (mut depth, mut in_string, mut escaped) = (0u32, false, false);
        loop {
            let Some(byte) = self.peek()? else {
                return Err(AppError::validation(format!(
                    "linha {start}: o documento não fecha até o fim do arquivo"
                )));
            };
            self.input.consume(1);
            text.push(byte);
            match byte {
                b'\n' => self.line += 1,
                _ if escaped => escaped = false,
                b'\\' if in_string => escaped = true,
                b'"' => in_string = !in_string,
                b'{' | b'[' if !in_string => depth += 1,
                b'}' | b']' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }
        let text = String::from_utf8(text).map_err(|_| {
            AppError::validation(format!("linha {start}: o arquivo não está em UTF-8"))
        })?;
        Ok(Some((start, text)))
    }

    fn peek(&mut self) -> Result<Option<u8>, AppError> {
        Ok(self.input.fill_buf()?.first().copied())
    }
}

#[cfg(test)]
mod tests {

    fn documents(text: &str) -> Result<Vec<(u64, String)>, AppError> {
        let mut reader = DocumentReader::new(text.as_bytes());
        let mut out = Vec::new();
        while let Some(document) = reader.next_document()? {
            out.push(document);
        }
        Ok(out)
    }

    #[test]
    fn reads_ndjson_and_arrays_as_written() {
        let ndjson = "{\"a\": \"}{\\\"\"}\n\n{\"b\": [1, {\"c\": 2}]}\r\n";
        assert_eq!(
            documents(ndjson).unwrap(),
            [
                (1, "{\"a\": \"}{\\\"\"}".to_string()),
                (3, "{\"b\": [1, {\"c\": 2}]}".to_string())
            ]
        );
        let array = "[\n  {\"_id\": 1},\n  {\n    \"_id\": 2\n  }\n]\n";
        assert_eq!(
            documents(array).unwrap(),
            [
                (2, "{\"_id\": 1}".to_string()),
                (3, "{\n    \"_id\": 2\n  }".to_string())
            ]
        );
        assert!(documents("[]").unwrap().is_empty());
        assert!(documents("  \n").unwrap().is_empty());
    }

    #[test]
    fn says_which_line_is_wrong() {
        let error = |text: &str| documents(text).unwrap_err().to_string();
        assert_eq!(
            error("{\"a\": 1}\n2\n"),
            "linha 2: esperado um documento JSON ({…})"
        );
        assert_eq!(
            error("{\"a\": 1},\n"),
            "linha 1: esperado um documento JSON ({…})"
        );
        assert_eq!(
            error("[{\"a\": 1}\n"),
            "linha 2: o array JSON não fecha com ]"
        );
        assert_eq!(
            error("[{}] {}"),
            "linha 1: esperado um documento JSON ({…})"
        );
        assert_eq!(
            error("\n{\"a\": \"x\n"),
            "linha 2: o documento não fecha até o fim do arquivo"
        );
        let latin1: &[u8] = b"{\"a\": \"S\xe3o\"}";
        assert_eq!(
            DocumentReader::new(latin1)
                .next_document()
                .unwrap_err()
                .to_string(),
            "linha 1: o arquivo não está em UTF-8"
        );
    }
    use super::*;
    use mongodb::bson::spec::BinarySubtype;
    use mongodb::bson::{Binary, DateTime, Decimal128, doc, oid::ObjectId};

    fn sample() -> Document {
        doc! {
            "_id": ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap(),
            "name": "Ana",
            "small_long": 5_i64,
            "big_long": 9_007_199_254_740_993_i64,
            "int": 30_i32,
            "double": 1.0_f64,
            "price": "19.90".parse::<Decimal128>().unwrap(),
            "created": DateTime::from_millis(1_704_067_200_000),
            "ancient": DateTime::from_millis(-62_135_596_800_000),
            "avatar": Binary { subtype: BinarySubtype::Generic, bytes: vec![0, 255] },
            "tags": ["a", { "nested_long": 7_i64 }],
            "nothing": Bson::Null,
            "zeta_first": true,
        }
    }

    #[test]
    fn round_trip_keeps_every_type_and_the_field_order() {
        let original = sample();

        let back = parse_document(&to_text(original.clone()), "doc").unwrap();

        assert_eq!(back, original);
        let keys: Vec<&String> = back.keys().collect();
        assert_eq!(keys.last().unwrap().as_str(), "zeta_first");
    }

    #[test]
    fn longs_are_explicit_and_safe_for_javascript() {
        let text = to_text(doc! { "small": 5_i64, "big": 9_007_199_254_740_993_i64, "int": 5_i32 });

        assert_eq!(
            text,
            r#"{"small":{"$numberLong":"5"},"big":{"$numberLong":"9007199254740993"},"int":5}"#
        );
    }

    #[test]
    fn readable_wrappers_for_common_types() {
        let text = to_text(sample());

        assert!(text.contains(r#""_id":{"$oid":"65a1b2c3d4e5f60718293a4b"}"#));
        assert!(text.contains(r#""created":{"$date":"2024-01-01T00:00:00Z"}"#));
        assert!(text.contains(r#""price":{"$numberDecimal":"19.90"}"#));
        assert!(text.contains(r#""double":1.0"#));
    }

    #[test]
    fn parses_user_input() {
        assert_eq!(parse_document("", "filtro").unwrap(), Document::new());
        assert_eq!(parse_document("  ", "filtro").unwrap(), Document::new());
        assert_eq!(
            parse_document(
                r#"{"age": {"$gt": 30}, "_id": {"$oid": "65a1b2c3d4e5f60718293a4b"}}"#,
                "filtro"
            )
            .unwrap(),
            doc! { "age": { "$gt": 30 }, "_id": ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap() }
        );
        assert_eq!(
            parse_pipeline(r#"[{"$match": {}}, {"$limit": 5}]"#).unwrap(),
            vec![doc! { "$match": {} }, doc! { "$limit": 5 }]
        );
        assert_eq!(
            parse_value(r#"{"$oid": "65a1b2c3d4e5f60718293a4b"}"#, "_id").unwrap(),
            Bson::ObjectId(ObjectId::parse_str("65a1b2c3d4e5f60718293a4b").unwrap())
        );
    }

    #[test]
    fn rejects_bad_input_with_a_message() {
        let cases = [
            (
                parse_document("{oops", "filtro").unwrap_err(),
                "filtro: JSON inválido",
            ),
            (
                parse_document("[1]", "filtro").unwrap_err(),
                "filtro: esperado um objeto JSON",
            ),
            (
                parse_document(r#"{"_id": {"$oid": "nope"}}"#, "documento").unwrap_err(),
                "documento: Extended JSON inválido",
            ),
            (
                parse_pipeline("{}").unwrap_err(),
                "pipeline: esperado um array",
            ),
            (
                parse_pipeline("[1]").unwrap_err(),
                "pipeline: cada estágio deve ser um objeto",
            ),
        ];
        for (error, prefix) in cases {
            assert!(error.to_string().starts_with(prefix), "{error}");
        }
    }
}
