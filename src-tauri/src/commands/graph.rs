//! Graph commands: the library as a graph, and where its unfiled notes
//! belong.

use crate::*;

/// The library as a graph of notes, tags, and Spaces, for the Graph view.
#[tauri::command(async)]
pub fn library_graph(state: State<'_, AppState>) -> CmdResult<LibraryGraph> {
    Ok(locked_reader(&state)?.library_graph()?)
}

/// Where each live note in no Space most likely belongs, with reasons.
#[tauri::command(async)]
pub fn space_suggestions(state: State<'_, AppState>) -> CmdResult<Vec<SpaceSuggestion>> {
    Ok(locked_reader(&state)?.space_suggestions()?)
}

#[tauri::command(async)]
pub fn tag_suggestion(
    state: State<'_, AppState>,
    note_id: String,
) -> CmdResult<Option<TagSuggestion>> {
    Ok(locked_reader(&state)?.tag_suggestion(&note_id)?)
}

/// The user said a note does not belong in a Space; stop suggesting it.
/// Device-local UI state in the settings table, so no library event.
#[tauri::command(async)]
pub fn dismiss_space_suggestion(
    state: State<'_, AppState>,
    note_id: String,
    space_id: String,
) -> CmdResult<()> {
    locked(&state)?.dismiss_space_suggestion(&note_id, &space_id)?;
    Ok(())
}

/// Undo of a dismissal: the pair can be suggested again.
#[tauri::command(async)]
pub fn restore_space_suggestion(
    state: State<'_, AppState>,
    note_id: String,
    space_id: String,
) -> CmdResult<()> {
    locked(&state)?.restore_space_suggestion(&note_id, &space_id)?;
    Ok(())
}
