use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::domain::{AppError, Environment};
use crate::tray;
use crate::use_cases::sql;

/// Ctrl+Q: closing the window only hides it (the app stays in the tray), so the
/// window needs its own way to quit when the tray is out of reach.
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// The window's X, once the UI has said so (see lib.rs): hides the window and closes
/// the production sessions, so production is never open behind a window out of sight.
/// Every query reconnects first, so they come back on their next use.
#[tauri::command]
#[specta::specta]
pub async fn hide_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("main") {
        // best effort: a window that cannot hide stays open, nothing is lost
        let _ = window.hide();
    }
    for id in state.registry.connected_in(Environment::Prod) {
        sql::disconnect(&state.registry, &id).await;
    }
    tray::refresh(&app);
    Ok(())
}
