use tauri::State;

use crate::AppState;
use crate::domain::{AppError, KillAction, KillResponse, SessionList};
use crate::use_cases::sessions;

#[tauri::command]
#[specta::specta]
pub async fn list_sessions(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<SessionList, AppError> {
    sessions::list(&state.registry, &connection_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn kill_session(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
    action: KillAction,
    confirmed: bool,
) -> Result<KillResponse, AppError> {
    sessions::kill(
        &state.registry,
        &state.history,
        &connection_id,
        &session_id,
        action,
        confirmed,
    )
    .await
}
