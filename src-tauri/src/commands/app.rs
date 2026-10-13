use tauri::AppHandle;

/// Ctrl+Q: closing the window only hides it (the app stays in the tray), so the
/// window needs its own way to quit when the tray is out of reach.
#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
