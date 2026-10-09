use crate::*;
use instantnotes_core::sheet::Sheet;

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
    let mut note = locked(&state)?.update_note(&id, patch)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    note.surface_data = None;
    Ok(note)
}

#[tauri::command(async)]
pub fn sheet_csv(state: State<'_, AppState>, id: String) -> CmdResult<String> {
    let note = locked(&state)?.get_note(&id, false)?;
    if note.content_kind != CONTENT_KIND_SHEET {
        return Err(CmdError::validation("only a sheet exports as CSV"));
    }
    let sheet = Sheet::parse(note.surface_data.as_deref().unwrap_or_default())
        .map_err(CmdError::validation)?;
    Ok(sheet.csv())
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
pub fn list_notes(state: State<'_, AppState>, filter: Option<NoteFilter>) -> CmdResult<Vec<Note>> {
    Ok(locked_reader(&state)?.list_notes(filter.unwrap_or_default())?)
}

#[tauri::command(async)]
pub fn count_notes(state: State<'_, AppState>, filter: Option<NoteFilter>) -> CmdResult<i64> {
    Ok(locked_reader(&state)?.count_notes(&filter.unwrap_or_default())?)
}

#[tauri::command(async)]
pub fn search_notes(
    state: State<'_, AppState>,
    text: String,
    limit: Option<i64>,
) -> CmdResult<Vec<SearchResult>> {
    Ok(locked_reader(&state)?.search_notes(&text, limit.unwrap_or(50))?)
}

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
    destroy_with_attachments(&state, &app, &ids, |store| {
        store.destroy_notes(&ids, confirm)
    })?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}

fn destroy_with_attachments(
    state: &State<'_, AppState>,
    app: &AppHandle,
    ids: &[String],
    destroy: impl FnOnce(&mut Store) -> instantnotes_core::error::Result<()>,
) -> CmdResult<()> {
    let mut store = locked(state)?;
    let names = store.attachment_names_of(ids)?;
    destroy(&mut store)?;
    if !names.is_empty() {
        if let Ok(dir) = attachments_dir(app) {
            let _ = store.remove_unreferenced_attachments(&dir, names);
        }
    }
    Ok(())
}
