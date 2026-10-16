use tauri::State;
use tauri::ipc::Channel;

use crate::AppState;
use crate::domain::{
    AggregateResponse, AppError, DocumentPage, FindRequest, IndexInfo, WatchMessage, WriteRequest,
    WriteResponse,
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
pub async fn watch_collection(
    state: State<'_, AppState>,
    connection_id: String,
    watch_id: String,
    database: String,
    collection: String,
    pipeline: String,
    on_message: Channel<WatchMessage>,
) -> Result<(), AppError> {
    mongo::watch_collection(
        &state.registry,
        &connection_id,
        &watch_id,
        &database,
        &collection,
        &pipeline,
        move |message| on_message.send(message).is_ok(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub fn stop_watch(state: State<'_, AppState>, watch_id: String) {
    state.registry.stop_watch(&watch_id);
}
