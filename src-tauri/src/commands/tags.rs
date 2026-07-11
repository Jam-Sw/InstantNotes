//! Tag commands.

use crate::*;

#[tauri::command(async)]
pub fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<TagWithCount>> {
    Ok(locked(&state)?.list_tags()?)
}

#[tauri::command(async)]
pub fn get_or_create_tag(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
) -> CmdResult<Tag> {
    let tag = locked(&state)?.get_or_create_tag(&name)?;
    emit_tags_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
pub fn update_tag(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> CmdResult<Tag> {
    let tag = locked(&state)?.update_tag(&id, name, color)?;
    emit_tags_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
pub fn delete_tag(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<()> {
    locked(&state)?.delete_tag(&id)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn add_tag_to_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    name: String,
) -> CmdResult<Tag> {
    let tag = locked(&state)?.add_tag_to_note(&note_id, &name)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
pub fn remove_tag_from_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    tag_id: String,
) -> CmdResult<()> {
    locked(&state)?.remove_tag_from_note(&note_id, &tag_id)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn tags_for_note(state: State<'_, AppState>, note_id: String) -> CmdResult<Vec<Tag>> {
    Ok(locked(&state)?.tags_for_note(&note_id)?)
}
