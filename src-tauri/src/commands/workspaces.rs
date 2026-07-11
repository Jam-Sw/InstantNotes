//! Workspace commands.

use crate::*;

#[tauri::command(async)]
pub fn list_workspaces(state: State<'_, AppState>) -> CmdResult<Vec<WorkspaceWithCount>> {
    Ok(locked(&state)?.list_workspaces()?)
}

#[tauri::command(async)]
pub fn get_or_create_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
) -> CmdResult<Workspace> {
    let ws = locked(&state)?.get_or_create_workspace(&name)?;
    emit_workspaces_changed(&app);
    Ok(ws)
}

#[tauri::command(async)]
pub fn rename_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    name: String,
) -> CmdResult<Workspace> {
    let ws = locked(&state)?.rename_workspace(&id, &name)?;
    emit_workspaces_changed(&app);
    Ok(ws)
}

#[tauri::command(async)]
pub fn delete_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> CmdResult<Vec<String>> {
    let member_note_ids = locked(&state)?.delete_workspace(&id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(member_note_ids)
}

#[tauri::command(async)]
pub fn list_workspace_tags(
    state: State<'_, AppState>,
    workspace_id: String,
) -> CmdResult<Vec<TagWithCount>> {
    Ok(locked(&state)?.list_workspace_tags(&workspace_id)?)
}

#[tauri::command(async)]
pub fn add_note_to_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    workspace_id: String,
) -> CmdResult<()> {
    locked(&state)?.add_note_to_workspace(&note_id, &workspace_id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn remove_note_from_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    workspace_id: String,
) -> CmdResult<()> {
    locked(&state)?.remove_note_from_workspace(&note_id, &workspace_id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn workspaces_for_note(
    state: State<'_, AppState>,
    note_id: String,
) -> CmdResult<Vec<Workspace>> {
    Ok(locked(&state)?.workspaces_for_note(&note_id)?)
}
