//! The Ordo mark in the system tray. On Linux the tray is an AppIndicator, which
//! has no click events: everything goes through the menu. Closing the window only
//! hides it (see lib.rs): "Abrir Ordo" brings it back, "Sair" ends the app. The
//! first line says how many sessions are open, so a hidden window never hides one.
//! "Procurar atualizações" shows the window, where the update dialog answers.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, Wry};

use crate::AppState;

const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
const STATUS_ID: &str = "status";
const OPEN_ID: &str = "open";
const UPDATE_ID: &str = "update";
const QUIT_ID: &str = "quit";

/// The menu's status line, rewritten whenever a session opens or closes.
struct TrayStatus(MenuItem<Wry>);

pub fn setup(app: &App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, STATUS_ID, status_text(0), false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, OPEN_ID, "Abrir Ordo", true, None::<&str>)?;
    let update = MenuItem::with_id(app, UPDATE_ID, "Procurar atualizações", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status, &separator, &open, &update, &quit])?;
    app.manage(TrayStatus(status));

    // On Linux the id names the icon file ($XDG_RUNTIME_DIR/tray-icon/tray-icon-<id>-0.png) and the
    // AppIndicator: a generic id like "main" collides with any other Tauri app using it, and both
    // trays end up showing (or losing) the same icon file.
    TrayIconBuilder::with_id("ordo")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .tooltip("Ordo")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ID => show_main_window(app),
            UPDATE_ID => {
                show_main_window(app);
                // best effort: a window that cannot hear it just shows no dialog
                let _ = app.emit("check-updates", ());
            }
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Rewrites the status line from the registry; call after a session opens or closes.
pub fn refresh(app: &AppHandle) {
    let count = app.state::<AppState>().registry.connection_count();
    if let Some(status) = app.try_state::<TrayStatus>() {
        // best effort: a stale count in the menu loses nothing
        let _ = status.0.set_text(status_text(count));
    }
}

fn status_text(count: usize) -> String {
    match count {
        0 => "Nenhuma conexão aberta".to_string(),
        1 => "1 conexão aberta".to_string(),
        n => format!("{n} conexões abertas"),
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // best effort: a window that cannot be raised is still open
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn tray_icon_decodes() {
        let icon = tauri::image::Image::from_bytes(super::TRAY_ICON).expect("tray.png must decode");
        assert_eq!((icon.width(), icon.height()), (64, 64));
    }

    #[test]
    fn status_counts_in_words() {
        assert_eq!(super::status_text(0), "Nenhuma conexão aberta");
        assert_eq!(super::status_text(1), "1 conexão aberta");
        assert_eq!(super::status_text(3), "3 conexões abertas");
    }
}
