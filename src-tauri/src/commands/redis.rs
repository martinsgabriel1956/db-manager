use tauri::State;
use tauri::ipc::Channel;

use crate::AppState;
use crate::domain::{
    AppError, CommandResponse, InfoSection, KeyDetail, KeyEditRequest, KeyEditResponse, KeyPage,
    LiveStart, MonitorEvent, PubSubEvent, RedisDatabase,
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

/// Subscribes on a dedicated connection; messages arrive on `on_event` until
/// `stop_redis_session`.
#[tauri::command]
#[specta::specta]
pub async fn redis_subscribe(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    on_event: Channel<PubSubEvent>,
) -> Result<(), AppError> {
    redis::subscribe(
        &state.registry,
        &connection_id,
        &session_id,
        &channels,
        &patterns,
        move |event| on_event.send(event).is_ok(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub fn stop_redis_session(state: State<'_, AppState>, connection_id: String, session_id: String) {
    redis::stop_session(&state.registry, &connection_id, &session_id);
}

#[tauri::command]
#[specta::specta]
pub async fn redis_publish(
    state: State<'_, AppState>,
    connection_id: String,
    db: u8,
    channel: String,
    message: String,
    confirmed: bool,
) -> Result<CommandResponse, AppError> {
    redis::publish(
        &state.registry,
        &state.history,
        &connection_id,
        db,
        &channel,
        &message,
        confirmed,
    )
    .await
}

/// MONITOR on a dedicated connection; lines arrive on `on_event` until
/// `stop_redis_session` or the limits. Prod asks first.
#[tauri::command]
#[specta::specta]
pub async fn redis_monitor(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    confirmed: bool,
    on_event: Channel<MonitorEvent>,
) -> Result<LiveStart, AppError> {
    redis::monitor(
        &state.registry,
        &connection_id,
        &session_id,
        confirmed,
        move |event| on_event.send(event).is_ok(),
    )
    .await
}
