use std::sync::PoisonError;

use tauri::{AppHandle, State};

use crate::AppState;
use crate::domain::{
    AppError, ApplyResponse, BrowseRequest, Cell, CompletionTable, DiagramTable, ExplainResponse,
    HistoryEntry, RowBatch, RunResponse, SchemaInfo, TableChanges, TableDdl, TableStructure,
};
use crate::tray;
use crate::use_cases::{connections, sql};

#[tauri::command]
#[specta::specta]
pub async fn connect_database(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    // every query connects first: only a session that was not open changes the tray
    if state.registry.is_connected(&connection_id) {
        return Ok(());
    }
    let config = {
        let store = state.store.lock().unwrap_or_else(PoisonError::into_inner);
        connections::find(&store, &connection_id)?
    };
    sql::connect(&state.registry, state.secrets.as_ref(), config).await?;
    tray::refresh(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn disconnect_database(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    sql::disconnect(&state.registry, &connection_id).await;
    tray::refresh(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<SchemaInfo>, AppError> {
    sql::list_schemas(&state.registry, &connection_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn table_structure(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<TableStructure, AppError> {
    sql::table_structure(&state.registry, &connection_id, &schema, &table).await
}

#[tauri::command]
#[specta::specta]
pub async fn table_ddl(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<TableDdl, AppError> {
    sql::table_ddl(&state.registry, &connection_id, &schema, &table).await
}

#[tauri::command]
#[specta::specta]
pub async fn completion_tables(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<CompletionTable>, AppError> {
    sql::completion_tables(&state.registry, &connection_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn browse_table(
    state: State<'_, AppState>,
    connection_id: String,
    request: BrowseRequest,
) -> Result<RowBatch, AppError> {
    sql::browse(&state.registry, &connection_id, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn estimate_rows(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Option<String>, AppError> {
    sql::estimate_rows(&state.registry, &connection_id, &schema, &table).await
}

#[tauri::command]
#[specta::specta]
pub async fn count_rows(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    request: BrowseRequest,
) -> Result<String, AppError> {
    sql::count_rows(&state.registry, &connection_id, &run_id, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn run_script(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    sql: String,
    confirmed: bool,
) -> Result<RunResponse, AppError> {
    sql::run_script(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        &sql,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn explain(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    sql: String,
    analyze: bool,
    confirmed: bool,
) -> Result<ExplainResponse, AppError> {
    sql::explain(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        &sql,
        analyze,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub fn copy_as_insert(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<Cell>>,
) -> Result<String, AppError> {
    sql::copy_as_insert(
        &state.registry,
        &connection_id,
        &schema,
        &table,
        &columns,
        &rows,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn apply_changes(
    state: State<'_, AppState>,
    connection_id: String,
    changes: TableChanges,
    confirmed: bool,
) -> Result<ApplyResponse, AppError> {
    sql::apply_changes(
        &state.registry,
        &state.history,
        &connection_id,
        changes,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn search_history(
    state: State<'_, AppState>,
    text: String,
    connection_id: Option<String>,
    starred_only: bool,
) -> Result<Vec<HistoryEntry>, AppError> {
    sql::search_history(
        &state.history,
        &text,
        connection_id.as_deref(),
        starred_only,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn star_history(
    state: State<'_, AppState>,
    id: u32,
    starred: bool,
) -> Result<(), AppError> {
    state.history.set_starred(id, starred).await
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_more(
    state: State<'_, AppState>,
    cursor_id: String,
) -> Result<RowBatch, AppError> {
    sql::fetch_more(&state.registry, &cursor_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn close_cursor(state: State<'_, AppState>, cursor_id: String) -> Result<(), AppError> {
    sql::close_cursor(&state.registry, &cursor_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_run(state: State<'_, AppState>, run_id: String) -> Result<(), AppError> {
    sql::cancel_run(&state.registry, &run_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn schema_diagram(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<DiagramTable>, AppError> {
    sql::schema_diagram(&state.registry, &connection_id, &schema).await
}
