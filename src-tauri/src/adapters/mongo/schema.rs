//! Field paths of sampled documents: the BSON types found at each one, how many
//! documents have it and an example. It describes a sample, not the collection:
//! MongoDB enforces no schema, and a rare field may not be in the sample.

use std::collections::BTreeMap;

use mongodb::bson::{Bson, Document};

use super::ejson;
use crate::domain::{FieldSummary, TypeCount};

/// Longer examples are cut: a sampled string or binary can be megabytes.
const MAX_EXAMPLE_CHARS: usize = 200;

/// `Key` sorts before `Item`, so `tags.x` comes before `tags[]` and children
/// follow their parent.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Segment {
    Key(String),
    /// an array element
    Item,
}

#[derive(Default)]
struct Field {
    documents: u32,
    /// the last document counted, so the elements of one array count it once
    last_document: Option<usize>,
    types: BTreeMap<&'static str, u32>,
    example: Option<Bson>,
}

pub fn infer(documents: &[Document]) -> Vec<FieldSummary> {
    let mut fields = BTreeMap::new();
    for (index, document) in documents.iter().enumerate() {
        for (key, value) in document {
            visit(&mut fields, vec![Segment::Key(key.clone())], value, index);
        }
    }
    fields
        .into_iter()
        .map(|(path, field)| {
            let mut types: Vec<TypeCount> = field
                .types
                .into_iter()
                .map(|(name, count)| TypeCount {
                    name: name.to_string(),
                    count,
                })
                .collect();
            types.sort_by_key(|t| std::cmp::Reverse(t.count));
            let example = field.example.map(ejson::value_to_text);
            let cut = example
                .as_deref()
                .and_then(|text| text.char_indices().nth(MAX_EXAMPLE_CHARS))
                .map(|(at, _)| at);
            FieldSummary {
                path: display(&path),
                documents: field.documents,
                types,
                example_truncated: cut.is_some(),
                example: example.map(|text| text[..cut.unwrap_or(text.len())].to_string()),
            }
        })
        .collect()
}

fn visit(
    fields: &mut BTreeMap<Vec<Segment>, Field>,
    path: Vec<Segment>,
    value: &Bson,
    document: usize,
) {
    let field = fields.entry(path.clone()).or_default();
    if field.last_document != Some(document) {
        field.last_document = Some(document);
        field.documents += 1;
    }
    *field.types.entry(type_name(value)).or_default() += 1;
    let children: Vec<(Segment, &Bson)> = match value {
        Bson::Document(inner) => inner
            .iter()
            .map(|(key, value)| (Segment::Key(key.clone()), value))
            .collect(),
        Bson::Array(items) => items.iter().map(|item| (Segment::Item, item)).collect(),
        scalar => {
            // objects and arrays show through their children
            field.example.get_or_insert_with(|| scalar.clone());
            Vec::new()
        }
    };
    for (segment, child) in children {
        let mut child_path = path.clone();
        child_path.push(segment);
        visit(fields, child_path, child, document);
    }
}

/// `address.city`, `tags[]`, `items[].sku`
fn display(path: &[Segment]) -> String {
    let mut text = String::new();
    for segment in path {
        match segment {
            Segment::Item => text.push_str("[]"),
            Segment::Key(key) => {
                if !text.is_empty() {
                    text.push('.');
                }
                text.push_str(key);
            }
        }
    }
    text
}

/// The aliases `$type` accepts.
fn type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Binary(_) => "binData",
        Bson::Undefined => "undefined",
        Bson::ObjectId(_) => "objectId",
        Bson::Boolean(_) => "bool",
        Bson::DateTime(_) => "date",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::DbPointer(_) => "dbPointer",
        Bson::JavaScriptCode(_) => "javascript",
        Bson::Symbol(_) => "symbol",
        Bson::JavaScriptCodeWithScope(_) => "javascriptWithScope",
        Bson::Int32(_) => "int",
        Bson::Timestamp(_) => "timestamp",
        Bson::Int64(_) => "long",
        Bson::Decimal128(_) => "decimal",
        Bson::MinKey => "minKey",
        Bson::MaxKey => "maxKey",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    fn field<'a>(fields: &'a [FieldSummary], path: &str) -> &'a FieldSummary {
        fields.iter().find(|f| f.path == path).unwrap()
    }

    fn types(field: &FieldSummary) -> Vec<(&str, u32)> {
        field
            .types
            .iter()
            .map(|t| (t.name.as_str(), t.count))
            .collect()
    }

    #[test]
    fn paths_types_presence_and_examples() {
        let documents = [
            doc! { "_id": 1, "name": "Ana", "address": { "city": "SP" }, "tags": ["a", "b"], "n": 5_i64 },
            doc! { "_id": 2, "name": null, "tags": [], "items": [{ "sku": "x" }, { "sku": 3 }] },
            doc! { "_id": 3, "name": "Bia", "n": 1.5, "long": "é".repeat(300) },
        ];

        let fields = infer(&documents);

        let paths: Vec<&str> = fields.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "_id",
                "address",
                "address.city",
                "items",
                "items[]",
                "items[].sku",
                "long",
                "n",
                "name",
                "tags",
                "tags[]"
            ]
        );
        let name = field(&fields, "name");
        assert_eq!(
            (name.documents, types(name)),
            (3, vec![("string", 2), ("null", 1)])
        );
        assert_eq!(name.example.as_deref(), Some(r#""Ana""#));
        // two elements in one document: two occurrences, one document
        let tag = field(&fields, "tags[]");
        assert_eq!((tag.documents, types(tag)), (1, vec![("string", 2)]));
        assert_eq!(field(&fields, "tags").documents, 2);
        assert_eq!(field(&fields, "tags").example, None);
        let sku = field(&fields, "items[].sku");
        assert_eq!(types(sku), vec![("int", 1), ("string", 1)]);
        // Int64 keeps its Extended JSON form; long examples are cut on a char boundary
        let n = field(&fields, "n");
        assert_eq!(n.example.as_deref(), Some(r#"{"$numberLong":"5"}"#));
        assert_eq!(types(n), vec![("double", 1), ("long", 1)]);
        let long = field(&fields, "long");
        assert!(long.example_truncated);
        assert_eq!(
            long.example.as_ref().unwrap().chars().count(),
            MAX_EXAMPLE_CHARS
        );
        assert!(!name.example_truncated);
    }
}
