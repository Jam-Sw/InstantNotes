use crate::*;

#[tauri::command(async)]
pub fn library_graph(state: State<'_, AppState>) -> CmdResult<LibraryGraph> {
    Ok(locked_reader(&state)?.library_graph()?)
}

#[tauri::command(async)]
pub fn space_suggestions(state: State<'_, AppState>) -> CmdResult<Vec<SpaceSuggestion>> {
    Ok(locked_analyst(&state)?.space_suggestions()?)
}

#[tauri::command(async)]
pub fn tag_suggestion(
    state: State<'_, AppState>,
    note_id: String,
) -> CmdResult<Option<TagSuggestion>> {
    Ok(locked_analyst(&state)?.tag_suggestion(&note_id)?)
}

#[tauri::command(async)]
pub fn dismiss_space_suggestion(
    state: State<'_, AppState>,
    note_id: String,
    space_id: String,
) -> CmdResult<()> {
    locked(&state)?.dismiss_space_suggestion(&note_id, &space_id)?;
    Ok(())
}

#[tauri::command(async)]
pub fn restore_space_suggestion(
    state: State<'_, AppState>,
    note_id: String,
    space_id: String,
) -> CmdResult<()> {
    locked(&state)?.restore_space_suggestion(&note_id, &space_id)?;
    Ok(())
}

#[tauri::command(async)]
pub fn related_notes(
    state: State<'_, AppState>,
    note_id: String,
    passage: Option<String>,
    limit: Option<usize>,
) -> CmdResult<Vec<RelatedNote>> {
    Ok(locked_analyst(&state)?.related_notes(
        &note_id,
        passage.as_deref(),
        limit.unwrap_or(instantnotes_core::store::RELATED_DEFAULT_LIMIT),
    )?)
}

#[tauri::command(async)]
pub fn dismiss_related_note(
    state: State<'_, AppState>,
    note_id: String,
    related_id: String,
) -> CmdResult<()> {
    locked(&state)?.dismiss_related_note(&note_id, &related_id)?;
    Ok(())
}

#[tauri::command(async)]
pub fn restore_related_note(
    state: State<'_, AppState>,
    note_id: String,
    related_id: String,
) -> CmdResult<()> {
    locked(&state)?.restore_related_note(&note_id, &related_id)?;
    Ok(())
}
