use std::sync::PoisonError;

use tauri::State;

use crate::AppState;
use crate::domain::{
    AppError, BackupFormat, BackupOutcome, ConnectionConfig, Engine, RestoreResponse,
};
use crate::use_cases::{backup, connections};

/// The saved settings and password: the client tools connect on their own, not
/// through the app's session.
fn config_and_password(
    state: &AppState,
    connection_id: &str,
) -> Result<(ConnectionConfig, Option<String>), AppError> {
    let config = {
        let store = state.store.lock().unwrap_or_else(PoisonError::into_inner);
        connections::find(&store, connection_id)?
    };
    let password = match config.engine {
        Engine::Sqlite => None,
        _ => state.secrets.get(connection_id)?,
    };
    Ok((config, password))
}

#[tauri::command]
#[specta::specta]
pub async fn backup_database(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    format: BackupFormat,
    path: String,
) -> Result<BackupOutcome, AppError> {
    let (config, password) = config_and_password(&state, &connection_id)?;
    backup::backup(
        &state.registry,
        &state.history,
        &config,
        password,
        &run_id,
        format,
        &path,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn restore_database(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    path: String,
    confirmed: bool,
) -> Result<RestoreResponse, AppError> {
    let (config, password) = config_and_password(&state, &connection_id)?;
    backup::restore(
        &state.registry,
        &state.history,
        &config,
        password,
        &run_id,
        &path,
        confirmed,
    )
    .await
}
