//! The Ordo mark in the system tray. On Linux the tray is an AppIndicator, which
//! has no click events: everything goes through the menu.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Manager};

const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN_ID, "Abrir Ordo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .tooltip("Ordo")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ID => show_main_window(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
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
}
