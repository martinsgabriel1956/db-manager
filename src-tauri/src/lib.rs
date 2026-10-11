mod adapters;
mod commands;
mod domain;
mod registry;
mod storage;
mod use_cases;

use std::sync::Mutex;

use tauri::Manager;
use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};

use registry::Registry;
use storage::connections::ConnectionStore;
use storage::history::HistoryStore;
use storage::secrets::{OsKeychain, SecretStore};

const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts");

pub struct AppState {
    pub store: Mutex<ConnectionStore>,
    pub secrets: Box<dyn SecretStore>,
    pub registry: Registry,
    pub history: HistoryStore,
}

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            commands::connections::list_connections,
            commands::connections::save_connection,
            commands::connections::delete_connection,
            commands::sql::connect_database,
            commands::sql::disconnect_database,
            commands::sql::list_schemas,
            commands::sql::table_structure,
            commands::sql::completion_tables,
            commands::sql::browse_table,
            commands::sql::run_script,
            commands::sql::fetch_more,
            commands::sql::close_cursor,
            commands::sql::cancel_run,
            commands::sql::apply_changes,
            commands::sql::search_history,
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
        // UI state (open tabs, editor text), see src/features/tabs
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let history = tauri::async_runtime::block_on(HistoryStore::open(
                &data_dir.join("history.sqlite"),
            ))?;
            app.manage(AppState {
                store: Mutex::new(ConnectionStore::new(data_dir.join("connections.json"))),
                secrets: Box::new(OsKeychain),
                registry: Registry::default(),
                history,
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
