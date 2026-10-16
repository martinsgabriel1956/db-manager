pub mod ejson;
pub mod schema;

#[cfg(test)]
pub(crate) mod integration_tests;

use std::time::Duration;

use futures_util::TryStreamExt;
use mongodb::bson::{Bson, Document, doc};
use mongodb::change_stream::ChangeStream;
use mongodb::error::{Error as MongoError, ErrorKind};
use mongodb::options::{
    AggregateOptions, ClientOptions, Credential, FindOptions, InsertManyOptions, ServerAddress,
    Tls, TlsOptions,
};
use mongodb::results::CollectionType;
use mongodb::{Client, bson};

use crate::domain::{
    AppError, ChangeEvent, ConnectionConfig, DocumentPage, FindRequest, IndexInfo, Relation,
    RelationKind, SchemaInfo, Target, TlsMode,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Aggregation results shown at most; more than that is reported as truncated.
pub const MAX_AGGREGATE_DOCUMENTS: usize = 1000;
const SYSTEM_DATABASES: [&str; 3] = ["admin", "config", "local"];
/// server error codes
const MAX_TIME_EXPIRED: i32 = 50;
const INTERRUPTED: i32 = 11601;
/// "The $changeStream stage is only supported on replica sets"
const CHANGE_STREAM_STANDALONE: i32 = 40573;

/// A failed `insert_many`: the index of the refused document, when the server named one.
#[derive(Debug)]
pub struct InsertFailure {
    pub index: Option<usize>,
    pub error: AppError,
}

pub struct MongoAdapter {
    client: Client,
    default_database: Option<String>,
    timeout_secs: u32,
}

impl MongoAdapter {
    /// `secret` is the password (host/port target) or the whole connection string
    /// (URI target).
    pub async fn connect(
        config: &ConnectionConfig,
        secret: Option<String>,
    ) -> Result<Self, AppError> {
        let (mut options, default_database) = match &config.target {
            Target::Uri { database } => {
                let uri = secret.ok_or_else(|| {
                    AppError::validation("URI de conexão não encontrada no keychain")
                })?;
                let options = ClientOptions::parse(uri)
                    .await
                    .map_err(|err| connect_error(&err))?;
                let database = non_empty(database).or_else(|| options.default_database.clone());
                (options, database)
            }
            Target::Network {
                host,
                port,
                database,
                username,
            } => {
                let mut options = ClientOptions::default();
                options.hosts = vec![ServerAddress::Tcp {
                    host: host.clone(),
                    port: Some(*port),
                }];
                if !username.is_empty() {
                    options.credential = Some(
                        Credential::builder()
                            .username(username.clone())
                            .password(secret)
                            // users usually live in admin; a URI can say otherwise
                            .source("admin".to_string())
                            .build(),
                    );
                }
                options.tls = tls(config);
                // through a tunnel only this address is reachable: no replica set discovery
                if config.ssh.is_some() {
                    options.direct_connection = Some(true);
                }
                (options, non_empty(database))
            }
            Target::File { .. } | Target::RedisCluster { .. } | Target::RedisSentinel { .. } => {
                return Err(AppError::validation(
                    "MongoDB precisa de host/porta ou URI de conexão",
                ));
            }
        };
        options.app_name = Some("ordo".to_string());
        options.connect_timeout = Some(CONNECT_TIMEOUT);
        options.server_selection_timeout = Some(CONNECT_TIMEOUT);

        let client = Client::with_options(options).map_err(|err| connect_error(&err))?;
        // the driver connects lazily: ping so a wrong host/password fails here
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|err| connect_error(&err))?;
        Ok(Self {
            client,
            default_database,
            timeout_secs: config.timeout_secs,
        })
    }

    pub async fn close(&self) {
        self.client.clone().shutdown().await;
    }

    fn max_time(&self) -> Option<Duration> {
        (self.timeout_secs > 0).then(|| Duration::from_secs(u64::from(self.timeout_secs)))
    }

    fn error(&self, err: MongoError) -> AppError {
        map_error(&err, self.timeout_secs)
    }

    /// Databases are the schemas, collections the relations. Users without the
    /// listDatabases privilege still see the database of their connection.
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let names = match self.client.list_database_names().await {
            Ok(names) => names
                .into_iter()
                .filter(|name| !SYSTEM_DATABASES.contains(&name.as_str()))
                .collect(),
            Err(err) => match &self.default_database {
                Some(database) => vec![database.clone()],
                None => return Err(self.error(err)),
            },
        };

        let mut schemas = Vec::new();
        for name in names {
            let mut specs: Vec<_> = self
                .client
                .database(&name)
                .list_collections()
                .await
                .map_err(|err| self.error(err))?
                .try_collect()
                .await
                .map_err(|err| self.error(err))?;
            specs.sort_by(|a, b| a.name.cmp(&b.name));
            let relations = specs
                .into_iter()
                .filter(|spec| !spec.name.starts_with("system."))
                .map(|spec| Relation {
                    kind: match spec.collection_type {
                        CollectionType::View => RelationKind::View,
                        _ => RelationKind::Table,
                    },
                    name: spec.name,
                })
                .collect();
            schemas.push(SchemaInfo { name, relations });
        }
        Ok(schemas)
    }

    pub async fn indexes(
        &self,
        database: &str,
        collection: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let models: Vec<_> = self
            .collection(database, collection)
            .list_indexes()
            .await
            .map_err(|err| self.error(err))?
            .try_collect()
            .await
            .map_err(|err| self.error(err))?;
        Ok(models
            .into_iter()
            .map(|model| {
                let options = model.options.unwrap_or_default();
                let mut definition = ejson::to_text(model.keys);
                if options.unique == Some(true) {
                    definition.push_str(" UNIQUE");
                }
                if options.sparse == Some(true) {
                    definition.push_str(" SPARSE");
                }
                if let Some(ttl) = options.expire_after {
                    definition.push_str(&format!(" expireAfterSeconds: {}", ttl.as_secs()));
                }
                if let Some(filter) = options.partial_filter_expression {
                    definition.push_str(&format!(
                        " partialFilterExpression: {}",
                        ejson::to_text(filter)
                    ));
                }
                IndexInfo {
                    name: options.name.unwrap_or_default(),
                    definition,
                }
            })
            .collect())
    }

    /// createIndexes / dropIndexes, run as built so the confirmed command is the one that runs.
    pub async fn run_command(&self, database: &str, command: Document) -> Result<(), AppError> {
        self.client
            .database(database)
            .run_command(command)
            .await
            .map(drop)
            .map_err(|err| self.error(err))
    }

    /// One page; `page_size + 1` documents are read to know whether more exist.
    pub async fn find(&self, request: &FindRequest) -> Result<DocumentPage, AppError> {
        let filter = ejson::parse_document(&request.filter, "filtro")?;
        let sort = ejson::parse_document(&request.sort, "ordenação")?;
        let projection = ejson::parse_document(&request.projection, "projeção")?;
        let options = FindOptions::builder()
            .sort((!sort.is_empty()).then_some(sort))
            .projection((!projection.is_empty()).then_some(projection))
            .skip(u64::from(request.page) * u64::from(request.page_size))
            .limit(i64::from(request.page_size) + 1)
            .max_time(self.max_time())
            .build();

        let mut documents: Vec<Document> = self
            .collection(&request.database, &request.collection)
            .find(filter)
            .with_options(options)
            .await
            .map_err(|err| self.error(err))?
            .try_collect()
            .await
            .map_err(|err| self.error(err))?;
        let has_more = documents.len() > request.page_size as usize;
        documents.truncate(request.page_size as usize);
        Ok(DocumentPage {
            documents: documents.into_iter().map(ejson::to_text).collect(),
            has_more,
        })
    }

    /// Every document matching the request (paging ignored), handed to `each` as
    /// Extended JSON while the cursor streams. Tagged with `comment` so `kill`
    /// can stop it; no maxTimeMS, since an export may legitimately take long.
    pub async fn export_documents(
        &self,
        request: &FindRequest,
        comment: &str,
        mut each: impl FnMut(String) -> Result<(), AppError>,
    ) -> Result<u32, AppError> {
        let filter = ejson::parse_document(&request.filter, "filtro")?;
        let sort = ejson::parse_document(&request.sort, "ordenação")?;
        let projection = ejson::parse_document(&request.projection, "projeção")?;
        let options = FindOptions::builder()
            .sort((!sort.is_empty()).then_some(sort))
            .projection((!projection.is_empty()).then_some(projection))
            .comment(Some(Bson::String(comment.to_string())))
            .build();
        let mut cursor = self
            .collection(&request.database, &request.collection)
            .find(filter)
            .with_options(options)
            .await
            .map_err(|err| self.error(err))?;
        let mut count: u32 = 0;
        while let Some(document) = cursor.try_next().await.map_err(|err| self.error(err))? {
            each(ejson::to_text(document))?;
            count = count.saturating_add(1);
        }
        Ok(count)
    }

    /// Runs the pipeline tagged with `comment` so `kill` can find it. Returns the
    /// first documents and whether more existed.
    pub async fn aggregate(
        &self,
        database: &str,
        collection: &str,
        pipeline: Vec<Document>,
        comment: &str,
    ) -> Result<(Vec<String>, bool), AppError> {
        let options = AggregateOptions::builder()
            .comment(Some(Bson::String(comment.to_string())))
            .max_time(self.max_time())
            .build();
        let mut cursor = self
            .collection(database, collection)
            .aggregate(pipeline)
            .with_options(options)
            .await
            .map_err(|err| self.error(err))?;

        let mut documents = Vec::new();
        while let Some(document) = cursor.try_next().await.map_err(|err| self.error(err))? {
            if documents.len() == MAX_AGGREGATE_DOCUMENTS {
                // dropping the cursor kills it server-side
                return Ok((documents, true));
            }
            documents.push(ejson::to_text(document));
        }
        Ok((documents, false))
    }

    /// `$sample` of `size` documents, tagged with `comment` so `kill` can stop it.
    pub async fn sample(
        &self,
        database: &str,
        collection: &str,
        size: u32,
        comment: &str,
    ) -> Result<Vec<Document>, AppError> {
        let options = AggregateOptions::builder()
            .comment(Some(Bson::String(comment.to_string())))
            .max_time(self.max_time())
            .build();
        self.collection(database, collection)
            .aggregate(vec![doc! { "$sample": { "size": i64::from(size) } }])
            .with_options(options)
            .await
            .map_err(|err| self.error(err))?
            .try_collect()
            .await
            .map_err(|err| self.error(err))
    }

    /// Returns the new document's _id as Extended JSON.
    pub async fn insert(
        &self,
        database: &str,
        collection: &str,
        document: Document,
    ) -> Result<String, AppError> {
        let result = self
            .collection(database, collection)
            .insert_one(document)
            .await
            .map_err(|err| self.error(err))?;
        Ok(ejson::value_to_text(result.inserted_id))
    }

    /// Inserts in order, tagged with `comment` so `kill` can stop it. When the server
    /// refuses a document, the error carries its index: the ones before it went in.
    pub async fn insert_many(
        &self,
        database: &str,
        collection: &str,
        documents: Vec<Document>,
        comment: &str,
    ) -> Result<(), InsertFailure> {
        // ordered (the default): the server stops at the first refused document
        let options = InsertManyOptions::builder()
            .comment(Some(Bson::String(comment.to_string())))
            .build();
        let Err(err) = self
            .collection(database, collection)
            .insert_many(documents)
            .with_options(options)
            .await
        else {
            return Ok(());
        };
        let refused = match err.kind.as_ref() {
            ErrorKind::InsertMany(failure) => failure
                .write_errors
                .as_ref()
                .and_then(|errors| errors.iter().min_by_key(|error| error.index)),
            _ => None,
        };
        Err(match refused {
            Some(refused) => InsertFailure {
                index: Some(refused.index),
                error: if refused.code == INTERRUPTED {
                    AppError::cancelled()
                } else {
                    AppError::Database(format!(
                        "{} [{}]",
                        refused.message,
                        refused.code_name.as_deref().unwrap_or("")
                    ))
                },
            },
            None => InsertFailure {
                index: None,
                error: self.error(err),
            },
        })
    }

    /// Exactly one document must match the _id, otherwise it changed under us.
    pub async fn replace(
        &self,
        database: &str,
        collection: &str,
        id: Bson,
        document: Document,
    ) -> Result<(), AppError> {
        let result = self
            .collection(database, collection)
            .replace_one(doc! { "_id": id }, document)
            .await
            .map_err(|err| self.error(err))?;
        if result.matched_count != 1 {
            return Err(AppError::conflict());
        }
        Ok(())
    }

    pub async fn delete(&self, database: &str, collection: &str, id: Bson) -> Result<(), AppError> {
        let result = self
            .collection(database, collection)
            .delete_one(doc! { "_id": id })
            .await
            .map_err(|err| self.error(err))?;
        if result.deleted_count != 1 {
            return Err(AppError::conflict());
        }
        Ok(())
    }

    /// Cancels operations tagged with `comment` (our run id). Users may always kill
    /// their own operations, hence `$ownOps`.
    pub async fn kill(&self, comment: &str) -> Result<(), AppError> {
        let admin = self.client.database("admin");
        let current = admin
            .run_command(doc! { "currentOp": 1, "$ownOps": true, "command.comment": comment })
            .await
            .map_err(|err| self.error(err))?;
        let operations = current.get_array("inprog").cloned().unwrap_or_default();
        for operation in operations {
            if let Some(opid) = operation.as_document().and_then(|op| op.get("opid")) {
                admin
                    .run_command(doc! { "killOp": 1, "op": opid.clone() })
                    .await
                    .map_err(|err| self.error(err))?;
            }
        }
        Ok(())
    }

    /// Opens a change stream on the collection; `pipeline` filters or reshapes the events.
    pub async fn watch(
        &self,
        database: &str,
        collection: &str,
        pipeline: Vec<Document>,
    ) -> Result<ChangeFeed, AppError> {
        let stream = self
            .collection(database, collection)
            .watch()
            .pipeline(pipeline)
            .await
            .map_err(|err| match err.kind.as_ref() {
                ErrorKind::Command(command) if command.code == CHANGE_STREAM_STANDALONE => {
                    AppError::validation(format!(
                        "change streams exigem um replica set ou cluster fragmentado; este servidor é standalone ({})",
                        command.message
                    ))
                }
                _ => self.error(err),
            })?;
        Ok(ChangeFeed {
            // raw documents: a pipeline may reshape events beyond the typed form
            stream: stream.with_type::<Document>(),
            timeout_secs: self.timeout_secs,
        })
    }

    fn collection(&self, database: &str, collection: &str) -> mongodb::Collection<Document> {
        self.client.database(database).collection(collection)
    }
}

/// An open change stream. Dropping it closes the cursor on the server.
pub struct ChangeFeed {
    stream: ChangeStream<Document>,
    timeout_secs: u32,
}

impl ChangeFeed {
    /// Waits for the next event; `None` when the stream ended (invalidated).
    pub async fn next(&mut self) -> Result<Option<ChangeEvent>, AppError> {
        let event = self
            .stream
            .try_next()
            .await
            .map_err(|err| map_error(&err, self.timeout_secs))?;
        Ok(event.map(change_event))
    }
}

fn change_event(event: Document) -> ChangeEvent {
    let text = |key: &str| event.get_document(key).ok().cloned().map(ejson::to_text);
    let at = match (
        event.get_datetime("wallTime"),
        event.get_timestamp("clusterTime"),
    ) {
        (Ok(wall), _) => Some(*wall),
        (_, Ok(cluster)) => Some(bson::DateTime::from_millis(i64::from(cluster.time) * 1000)),
        _ => None,
    };
    ChangeEvent {
        operation: event.get_str("operationType").unwrap_or("?").to_string(),
        id: event
            .get_document("documentKey")
            .ok()
            .and_then(|key| key.get("_id"))
            .cloned()
            .map(ejson::value_to_text),
        document: text("fullDocument"),
        diff: text("updateDescription"),
        at: at.and_then(|at| at.try_to_rfc3339_string().ok()),
    }
}

fn map_error(err: &MongoError, timeout_secs: u32) -> AppError {
    match err.kind.as_ref() {
        ErrorKind::Command(command) if command.code == MAX_TIME_EXPIRED => {
            AppError::timeout(timeout_secs)
        }
        ErrorKind::Command(command) if command.code == INTERRUPTED => AppError::cancelled(),
        ErrorKind::Command(command) => {
            AppError::Database(format!("{} [{}]", command.message, command.code_name))
        }
        _ => AppError::Database(err.to_string()),
    }
}

/// Connection failures read better without the driver's topology dump: keep the
/// headline and the first server error inside it ("Connection refused", auth…).
fn connect_error(err: &MongoError) -> AppError {
    let message = err.to_string();
    let Some((head, topology)) = message.split_once(" Topology:") else {
        return AppError::Database(message);
    };
    let head = head.trim_start_matches("Kind: ").trim_end_matches('.');
    let cause = topology
        .split_once("Error: ")
        .and_then(|(_, rest)| rest.split(", labels").next())
        .map(|cause| cause.trim_start_matches("Kind: "));
    AppError::Database(match cause {
        Some(cause) => format!("{head} ({cause})"),
        None => head.to_string(),
    })
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// MongoDB has no opportunistic TLS: "prefer" means plain, "require" encrypts
/// without checking the certificate, "verify-full" checks it (optionally against a CA file).
fn tls(config: &ConnectionConfig) -> Option<Tls> {
    match config.tls.mode {
        TlsMode::Disable | TlsMode::Prefer => Some(Tls::Disabled),
        TlsMode::Require => Some(Tls::Enabled(
            TlsOptions::builder()
                .allow_invalid_certificates(Some(true))
                .build(),
        )),
        TlsMode::VerifyFull => Some(Tls::Enabled(
            TlsOptions::builder()
                .ca_file_path(config.tls.ca_cert_path.clone().map(Into::into))
                .build(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::error::CommandError;

    fn command_error(code: i32, name: &str) -> MongoError {
        let command: CommandError = mongodb::bson::from_document(doc! {
            "code": code, "codeName": name, "errmsg": "operation failed",
        })
        .unwrap();
        MongoError::from(ErrorKind::Command(command))
    }

    #[test]
    fn change_events_keep_their_values_as_extended_json() {
        let update = change_event(doc! {
            "operationType": "update",
            "documentKey": { "_id": 7_i64 },
            "updateDescription": { "updatedFields": { "n": 2 }, "removedFields": ["old"] },
            "clusterTime": bson::Timestamp { time: 1_700_000_000, increment: 1 },
        });
        assert_eq!(
            update,
            ChangeEvent {
                operation: "update".into(),
                id: Some(r#"{"$numberLong":"7"}"#.into()),
                document: None,
                diff: Some(r#"{"updatedFields":{"n":2},"removedFields":["old"]}"#.into()),
                at: Some("2023-11-14T22:13:20Z".into()),
            }
        );
        // a pipeline may project fields away: nothing is invented
        assert_eq!(change_event(doc! {}).operation, "?");
    }

    #[test]
    fn server_errors_map_to_app_errors() {
        assert!(matches!(
            map_error(&command_error(50, "MaxTimeMSExpired"), 3),
            AppError::Timeout(msg) if msg.contains("3s")
        ));
        assert!(matches!(
            map_error(&command_error(11601, "Interrupted"), 3),
            AppError::Cancelled(_)
        ));
        assert_eq!(
            map_error(&command_error(13, "Unauthorized"), 3).to_string(),
            "operation failed [Unauthorized]"
        );
    }
}
