//! Settings key/value commands.

use crate::*;


#[tauri::command(async)]
pub fn get_setting(state: State<'_, AppState>, key: String) -> CmdResult<Option<serde_json::Value>> {
    Ok(locked(&state)?.get_setting(&key)?)
}

#[tauri::command(async)]
pub fn set_setting(state: State<'_, AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    Ok(locked(&state)?.set_setting(&key, value)?)
}

#[tauri::command(async)]
pub fn delete_setting(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    Ok(locked(&state)?.delete_setting(&key)?)
}

