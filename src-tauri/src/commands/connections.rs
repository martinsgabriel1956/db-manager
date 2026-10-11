use std::sync::PoisonError;

use tauri::State;

use crate::AppState;
use crate::domain::{AppError, ConnectionConfig, KeychainOutcome, SecretChange};
use crate::use_cases::{connections, sql};

// The store lock serializes read-modify-write of connections.json. It guards no
// in-memory data, so recovering from a poisoned lock is safe. It is released before
// any await.

#[tauri::command]
#[specta::specta]
pub async fn list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionConfig>, AppError> {
    let store = state.store.lock().unwrap_or_else(PoisonError::into_inner);
    connections::list(&store)
}

/// Saving closes an open session of that connection: it must reconnect with the new settings.
#[tauri::command]
#[specta::specta]
pub async fn save_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    secret: SecretChange,
) -> Result<KeychainOutcome, AppError> {
    let id = config.id.clone();
    let outcome = {
        let store = state.store.lock().unwrap_or_else(PoisonError::into_inner);
        connections::save(&store, state.secrets.as_ref(), config, secret)?
    };
    sql::disconnect(&state.registry, &id).await;
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<KeychainOutcome, AppError> {
    let outcome = {
        let store = state.store.lock().unwrap_or_else(PoisonError::into_inner);
        connections::delete(&store, state.secrets.as_ref(), &id)?
    };
    sql::disconnect(&state.registry, &id).await;
    Ok(outcome)
}
