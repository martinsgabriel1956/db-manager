use tauri::State;

use crate::AppState;
use crate::domain::{AppError, BrowseRequest, DocumentFormat, ExportOutcome, FindRequest};
use crate::use_cases::export;

#[tauri::command]
#[specta::specta]
pub async fn export_query(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    sql: String,
    path: String,
) -> Result<ExportOutcome, AppError> {
    export::export_query(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        &sql,
        &path,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn export_table(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    request: BrowseRequest,
    path: String,
) -> Result<ExportOutcome, AppError> {
    export::export_table(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        request,
        &path,
    )
    .await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn export_collection(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    request: FindRequest,
    format: DocumentFormat,
    path: String,
) -> Result<ExportOutcome, AppError> {
    export::export_collection(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        request,
        format,
        &path,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn export_keys(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    db: u8,
    pattern: String,
    path: String,
) -> Result<ExportOutcome, AppError> {
    export::export_keys(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        db,
        &pattern,
        &path,
    )
    .await
}
