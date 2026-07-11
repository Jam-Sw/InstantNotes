//! Note commands: create, read, update, delete, list, search.

use crate::*;

#[tauri::command(async)]
pub fn create_note(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CreateNoteInput,
) -> CmdResult<Note> {
    let note = locked(&state)?.create_note(input)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
pub fn get_note(state: State<'_, AppState>, id: String, touch: Option<bool>) -> CmdResult<Note> {
    Ok(locked(&state)?.get_note(&id, touch.unwrap_or(false))?)
}

#[tauri::command(async)]
pub fn update_note(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    patch: UpdateNotePatch,
) -> CmdResult<Note> {
    let note = locked(&state)?.update_note(&id, patch)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
pub fn soft_delete_note(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<Note> {
    let note = locked(&state)?.soft_delete_note(&id)?;
    emit_notes_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
pub fn restore_note(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<Note> {
    let note = locked(&state)?.restore_note(&id)?;
    emit_notes_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
pub fn permanently_delete_note(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    confirm: bool,
) -> CmdResult<()> {
    locked(&state)?.permanently_delete_note(&id, confirm)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn list_notes(state: State<'_, AppState>, filter: Option<NoteFilter>) -> CmdResult<Vec<Note>> {
    Ok(locked(&state)?.list_notes(filter.unwrap_or_default())?)
}

#[tauri::command(async)]
pub fn search_notes(
    state: State<'_, AppState>,
    text: String,
    limit: Option<i64>,
) -> CmdResult<Vec<SearchResult>> {
    Ok(locked(&state)?.search_notes(&text, limit.unwrap_or(50))?)
}

// ---- bulk commands ----
// One transaction and one change event for a whole multi-select, instead of
// one round trip per note.

#[tauri::command(async)]
pub fn set_notes_flags(
    state: State<'_, AppState>,
    app: AppHandle,
    ids: Vec<String>,
    is_pinned: Option<bool>,
    is_archived: Option<bool>,
) -> CmdResult<()> {
    locked(&state)?.set_notes_flags(&ids, is_pinned, is_archived)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn soft_delete_notes(
    state: State<'_, AppState>,
    app: AppHandle,
    ids: Vec<String>,
) -> CmdResult<()> {
    locked(&state)?.soft_delete_notes(&ids)?;
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn restore_notes(
    state: State<'_, AppState>,
    app: AppHandle,
    ids: Vec<String>,
) -> CmdResult<()> {
    locked(&state)?.restore_notes(&ids)?;
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn destroy_notes(
    state: State<'_, AppState>,
    app: AppHandle,
    ids: Vec<String>,
    confirm: bool,
) -> CmdResult<()> {
    locked(&state)?.destroy_notes(&ids, confirm)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}
