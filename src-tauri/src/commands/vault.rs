use crate::*;
use instantnotes_core::vault::{self, VaultReport, VaultStatus};

fn validate_vault_dest(path: &str) -> CmdResult<()> {
    if !std::path::Path::new(path).is_absolute() {
        return Err(CmdError::storage("vault folder path must be absolute"));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_vault(state: State<'_, AppState>, app: AppHandle, dest: String) -> CmdResult<()> {
    validate_vault_dest(&dest)?;
    let dest_path = std::path::Path::new(&dest);

    let (notes, manifest) = {
        let store = locked(&state)?;
        if store
            .vault_root()
            .is_some_and(|root| vault::is_within(dest_path, root))
        {
            return Err(CmdError::storage(
                "that folder is your live vault, which is already up to date; \
                 choose another folder for the copy",
            ));
        }
        vault::collect_from_store(&store)?
    };

    vault::export_vault(&notes, &manifest, dest_path)
        .map_err(|e| CmdError::storage(format!("could not write vault: {e}")))?;

    let attachments_src = attachments_dir(&app)?;
    if attachments_src.is_dir() {
        vault::copy_dir_recursive(&attachments_src, &dest_path.join("attachments"))
            .map_err(|e| CmdError::storage(format!("could not copy attachments: {e}")))?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_vault_status(state: State<'_, AppState>) -> CmdResult<VaultStatus> {
    Ok(locked(&state)?.vault_status()?)
}

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
            .map_err(|e| CmdError::storage(format!("no app data dir: {e}")))?;
        vault::check_vault_location(std::path::Path::new(path), &app_data)
            .map_err(CmdError::storage)?;
    }
    locked(&state)?.configure_vault(path.as_deref().map(std::path::Path::new))?;
    if path.is_some() {
        let _ = mirror_attachments(&app);
        request_vault_flush(&app);
    }
    Ok(locked(&state)?.vault_status()?)
}

#[tauri::command(async)]
pub fn verify_vault(state: State<'_, AppState>, app: AppHandle) -> CmdResult<VaultReport> {
    flush_vault_now(&app, None);
    Ok(locked(&state)?.verify_vault()?)
}
