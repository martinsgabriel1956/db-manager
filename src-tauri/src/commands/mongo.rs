use tauri::State;

use crate::AppState;
use crate::domain::{
    AggregateResponse, AppError, DocumentPage, FindRequest, IndexInfo, IndexResponse, NewIndex,
    SchemaSample, WriteRequest, WriteResponse,
};
use crate::use_cases::mongo;

#[tauri::command]
#[specta::specta]
pub async fn browse_collection(
    state: State<'_, AppState>,
    connection_id: String,
    request: FindRequest,
) -> Result<DocumentPage, AppError> {
    mongo::browse_collection(&state.registry, &connection_id, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn collection_indexes(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<Vec<IndexInfo>, AppError> {
    mongo::collection_indexes(&state.registry, &connection_id, &database, &collection).await
}

#[tauri::command]
#[specta::specta]
pub fn index_statement(index: NewIndex) -> Result<String, AppError> {
    mongo::index_statement(&index)
}

#[tauri::command]
#[specta::specta]
pub async fn create_index(
    state: State<'_, AppState>,
    connection_id: String,
    index: NewIndex,
    confirmed: bool,
) -> Result<IndexResponse, AppError> {
    mongo::create_index(
        &state.registry,
        &state.history,
        &connection_id,
        index,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn drop_index(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    name: String,
    confirmed: bool,
) -> Result<IndexResponse, AppError> {
    mongo::drop_index(
        &state.registry,
        &state.history,
        &connection_id,
        &database,
        &collection,
        &name,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn run_aggregation(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    database: String,
    collection: String,
    pipeline: String,
    confirmed: bool,
) -> Result<AggregateResponse, AppError> {
    mongo::run_aggregation(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        &database,
        &collection,
        &pipeline,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_document(
    state: State<'_, AppState>,
    connection_id: String,
    request: WriteRequest,
    confirmed: bool,
) -> Result<WriteResponse, AppError> {
    mongo::write_document(
        &state.registry,
        &state.history,
        &connection_id,
        request,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sample_schema(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    database: String,
    collection: String,
    size: u32,
) -> Result<SchemaSample, AppError> {
    mongo::sample_schema(
        &state.registry,
        &connection_id,
        &run_id,
        &database,
        &collection,
        size,
    )
    .await
}
