use tauri::State;

use crate::AppState;
use crate::domain::{
    AppError, CommandResponse, InfoSection, KeyDetail, KeyEditRequest, KeyEditResponse, KeyPage,
    RedisDatabase,
};
use crate::use_cases::redis;

#[tauri::command]
#[specta::specta]
pub async fn redis_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<RedisDatabase>, AppError> {
    redis::databases(&state.registry, &connection_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn scan_keys(
    state: State<'_, AppState>,
    connection_id: String,
    db: u8,
    pattern: String,
    cursor: String,
) -> Result<KeyPage, AppError> {
    redis::scan_keys(&state.registry, &connection_id, db, &pattern, &cursor).await
}

#[tauri::command]
#[specta::specta]
pub async fn read_key(
    state: State<'_, AppState>,
    connection_id: String,
    db: u8,
    key: String,
) -> Result<KeyDetail, AppError> {
    redis::read_key(&state.registry, &connection_id, db, &key).await
}

#[tauri::command]
#[specta::specta]
pub async fn edit_key(
    state: State<'_, AppState>,
    connection_id: String,
    request: KeyEditRequest,
    confirmed: bool,
) -> Result<KeyEditResponse, AppError> {
    redis::edit_key(
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
pub async fn run_redis_command(
    state: State<'_, AppState>,
    connection_id: String,
    db: u8,
    command: String,
    confirmed: bool,
) -> Result<CommandResponse, AppError> {
    redis::run_command(
        &state.registry,
        &state.history,
        &connection_id,
        db,
        &command,
        confirmed,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn server_info(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<InfoSection>, AppError> {
    redis::server_info(&state.registry, &connection_id).await
}

/// The master address the sentinels resolved; null when not behind Sentinel.
#[tauri::command]
#[specta::specta]
pub async fn redis_master(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Option<String>, AppError> {
    Ok(state.registry.connection(&connection_id)?.redis()?.master())
}
