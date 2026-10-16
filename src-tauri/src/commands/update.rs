//! Signed updates from GitHub Releases (docs/decisions.md, Distribuição). The updater
//! replaces the AppImage, or installs the .deb through pkexec; any other install (a
//! bare `cargo build`) only learns that a version exists and is sent to the release page.

use serde::Serialize;
use specta::Type;
use tauri::AppHandle;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri_plugin_updater::UpdaterExt;

use crate::domain::AppError;

const RELEASES_URL: &str = "https://github.com/martinsgabriel1956/db-manager/releases/latest";

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    /// the newer version on GitHub Releases, if any
    pub available: Option<String>,
    /// the updater can replace this install; false = point to the release page
    pub installable: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheck, AppError> {
    let update = find_update(&app).await?;
    Ok(UpdateCheck {
        current: app.package_info().version.to_string(),
        available: update.map(|update| update.version),
        installable: installable(bundle_type()),
    })
}

/// Only after the user said yes (and dropped staged edits): installs, then restarts.
#[tauri::command]
#[specta::specta]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    let update = find_update(&app)
        .await?
        .ok_or_else(|| AppError::validation("nenhuma versão nova no GitHub Releases"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_release_page() -> Result<(), AppError> {
    tokio::process::Command::new("xdg-open")
        .arg(RELEASES_URL)
        .status()
        .await
        .map(drop)
        .map_err(|err| {
            AppError::validation(format!("não foi possível abrir {RELEASES_URL}: {err}"))
        })
}

async fn find_update(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, AppError> {
    app.updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)
}

fn installable(bundle: Option<BundleType>) -> bool {
    matches!(bundle, Some(BundleType::AppImage | BundleType::Deb))
}

/// Offline at launch is not worth a dialog, but it is written down: stderr ends in the
/// journal when Ordo starts from the launcher. The UI decides whether to show it.
fn update_error(err: tauri_plugin_updater::Error) -> AppError {
    eprintln!("ordo: atualização: {err}");
    AppError::validation(format!("falha ao buscar a atualização: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_appimage_and_deb_install_themselves() {
        assert!(installable(Some(BundleType::AppImage)));
        assert!(installable(Some(BundleType::Deb)));
        // rpm is not shipped (docs/decisions.md), and a bare binary has no bundle to replace
        assert!(!installable(Some(BundleType::Rpm)));
        assert!(!installable(None));
    }
}
