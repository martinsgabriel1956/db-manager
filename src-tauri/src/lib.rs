mod adapters;
mod commands;
mod domain;
mod registry;
mod storage;
mod tray;
mod use_cases;

use std::sync::Mutex;

use tauri::{Emitter, Manager};
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
            commands::app::quit_app,
            commands::app::hide_window,
            commands::connections::list_connections,
            commands::connections::save_connection,
            commands::connections::delete_connection,
            commands::connections::test_connection,
            commands::sql::connect_database,
            commands::sql::disconnect_database,
            commands::sql::list_schemas,
            commands::sql::table_structure,
            commands::sql::completion_tables,
            commands::sql::browse_table,
            commands::sql::run_script,
            commands::sql::explain,
            commands::sql::fetch_more,
            commands::sql::close_cursor,
            commands::sql::cancel_run,
            commands::sql::apply_changes,
            commands::sql::copy_as_insert,
            commands::sql::search_history,
            commands::sql::star_history,
            commands::sql::schema_diagram,
            commands::export::export_query,
            commands::export::export_table,
            commands::export::export_collection,
            commands::mongo::browse_collection,
            commands::mongo::collection_indexes,
            commands::mongo::run_aggregation,
            commands::mongo::write_document,
            commands::redis::redis_databases,
            commands::redis::scan_keys,
            commands::redis::read_key,
            commands::redis::edit_key,
            commands::redis::run_redis_command,
            commands::redis::server_info,
            commands::redis::server_modules,
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
        // must come first: a second launch (app menu, terminal) shows the running window
        // instead of starting another process with its own tray and connections
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        // UI state (open tabs, editor text), see src/features/tabs
        .plugin(tauri_plugin_store::Builder::new().build())
        // "save as" for exports
        .plugin(tauri_plugin_dialog::init())
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
            tray::setup(app)?;
            Ok(())
        })
        // the X never ends the app: the UI says (once) that Ordo stays in the tray, then
        // calls hide_window, which also closes production sessions; "Sair" in the tray or
        // Ctrl+Q ends it
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // best effort: if the UI cannot hear it, the window stays open, nothing is lost
                let _ = window.emit("close-requested", ());
            }
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
