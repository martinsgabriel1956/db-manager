use tauri::State;

use crate::AppState;
use crate::domain::{AppError, CsvImport, CsvPreview, ImportResponse};
use crate::use_cases::import;

#[tauri::command]
#[specta::specta]
pub async fn preview_csv(path: String) -> Result<CsvPreview, AppError> {
    import::preview_csv(&path)
}

#[tauri::command]
#[specta::specta]
pub async fn import_csv(
    state: State<'_, AppState>,
    connection_id: String,
    run_id: String,
    request: CsvImport,
    confirmed: bool,
) -> Result<ImportResponse, AppError> {
    import::import_csv(
        &state.registry,
        &state.history,
        &connection_id,
        &run_id,
        request,
        confirmed,
    )
    .await
}
