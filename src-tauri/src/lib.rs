mod commands;
mod domain;
mod storage;
mod use_cases;

use std::sync::Mutex;

use tauri::Manager;
use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};

use storage::connections::ConnectionStore;
use storage::secrets::{OsKeychain, SecretStore};

const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts");

pub struct AppState {
    pub store: Mutex<ConnectionStore>,
    pub secrets: Box<dyn SecretStore>,
}

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            commands::connections::list_connections,
            commands::connections::save_connection,
            commands::connections::delete_connection,
        ])
}

fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("failed to export typescript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                store: Mutex::new(ConnectionStore::new(data_dir.join("connections.json"))),
                secrets: Box::new(OsKeychain),
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Regenerates src/bindings.ts without launching the app. CI fails if the
    /// committed file differs, so Rust and TS types cannot drift.
    #[test]
    fn export_typescript_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
