//! Vault commands for `feat-portable-vault-sync`. Stage 1: a one-way export
//! of the whole library to a folder the user picks. Stage 2: the live
//! mirror, configured here and written by `shell/mirror.rs`. SQLite stays
//! authoritative throughout; nothing here reads a vault back.
//!
//! The store->VaultNote gather lives in `instantnotes-core::vault`
//! (`collect_from_store`), not here: this crate is IPC plumbing only
//! (lib.rs's stated dependency rule), and that gather is exactly the
//! business logic the rule keeps out of it. It's also exercised by a real
//! SQLite store in `core/tests/store_test.rs::vault_export`, which this
//! command's own layer has no equivalent way to test without a Tauri
//! runtime.

use crate::*;
use instantnotes_core::vault::{self, VaultReport, VaultStatus};

fn storage_error(message: impl Into<String>) -> CmdError {
    CmdError {
        code: "STORAGE_ERROR".into(),
        message: message.into(),
    }
}

/// The destination is chosen by the user through a native folder-picker
/// dialog in JS, same trust boundary as `export_note_file`.
fn validate_vault_dest(path: &str) -> CmdResult<()> {
    if !std::path::Path::new(path).is_absolute() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "vault folder path must be absolute".into(),
        });
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_vault(state: State<'_, AppState>, app: AppHandle, dest: String) -> CmdResult<()> {
    validate_vault_dest(&dest)?;
    let dest_path = std::path::Path::new(&dest);

    let (notes, manifest) = {
        let store = locked(&state)?;
        // An export into the live mirror would write a second copy of every
        // note beside the mirror's own files.
        if store
            .vault_root()
            .is_some_and(|root| vault::is_within(dest_path, root))
        {
            return Err(storage_error(
                "that folder is your live vault, which is already up to date; \
                 choose another folder for the copy",
            ));
        }
        vault::collect_from_store(&store)?
    };

    vault::export_vault(&notes, &manifest, dest_path).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write vault: {e}"),
    })?;

    let attachments_src = attachments_dir(&app)?;
    if attachments_src.is_dir() {
        vault::copy_dir_recursive(&attachments_src, &dest_path.join("attachments")).map_err(
            |e| CmdError {
                code: "STORAGE_ERROR".into(),
                message: format!("could not copy attachments: {e}"),
            },
        )?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_vault_status(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    Ok(locked(&state)?.vault_status()?)
}

/// Start mirroring into `path`, move the mirror there, or stop it (`None`).
/// The folder is chosen through the native picker in JS. Returns right away:
/// the first write of a large library happens in the background, and the
/// status reports how many notes are still pending.
#[tauri::command(async)]
pub fn set_vault_folder(
    state: State<'_, AppState>,
    app: AppHandle,
    path: Option<String>,
) -> CmdResult<VaultStatus> {
    if let Some(path) = &path {
        validate_vault_dest(path)?;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| storage_error(format!("no app data dir: {e}")))?;
        vault::check_vault_location(std::path::Path::new(path), &app_data)
            .map_err(storage_error)?;
    }
    locked(&state)?.configure_vault(path.as_deref().map(std::path::Path::new))?;
    if path.is_some() {
        // The notes follow through the flusher; a failure here shows up as
        // missing images in the vault, not as a failed setup.
        let _ = mirror_attachments(&app);
        request_vault_flush(&app);
    }
    Ok(locked(&state)?.vault_status()?)
}

/// Flush anything pending, then compare every file in the vault with the
/// library. Read-only: it reports differences and changes nothing.
#[tauri::command(async)]
pub fn verify_vault(state: State<'_, AppState>, app: AppHandle) -> CmdResult<VaultReport> {
    flush_vault_now(&app, None);
    Ok(locked(&state)?.verify_vault()?)
}
