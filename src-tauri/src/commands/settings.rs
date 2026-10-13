use crate::*;

#[tauri::command(async)]
pub fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> CmdResult<Option<serde_json::Value>> {
    Ok(locked(&state)?.get_setting(&key)?)
}

#[tauri::command(async)]
pub fn set_setting(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> CmdResult<()> {
    locked(&state)?.set_setting(&key, value)?;
    if instantnotes_core::store::is_shared_setting(&key) {
        request_vault_sync(&app);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn delete_setting(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    Ok(locked(&state)?.delete_setting(&key)?)
}
