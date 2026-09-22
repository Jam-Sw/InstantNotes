//! Vault export (stage 1 of `feat-portable-vault-sync`: pure addition;
//! SQLite stays authoritative. See design.md, SEQUENCE.md unit 7). Writes the
//! whole library to a folder the user picks; nothing here is read back yet.
//!
//! The store->VaultNote gather lives in `instantnotes-core::vault`
//! (`collect_from_store`), not here: this crate is IPC plumbing only
//! (lib.rs's stated dependency rule), and that gather is exactly the
//! business logic the rule keeps out of it. It's also exercised by a real
//! SQLite store in `core/tests/store_test.rs::vault_export`, which this
//! command's own layer has no equivalent way to test without a Tauri
//! runtime.

use crate::*;
use instantnotes_core::vault;

/// The destination is chosen by the user through a native folder-picker
/// dialog in JS, same trust boundary as `export_note_file`.
fn validate_vault_dest(path: &str) -> CmdResult<()> {
    if !std::path::Path::new(path).is_absolute() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "vault export path must be absolute".into(),
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
