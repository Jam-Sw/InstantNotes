//! The app's side of agent access (`instantnotes-agents`). An agent writes
//! through its own process and its own connection to the library, so the
//! app learns of it the way SQLite reports it: `data_version` moves only
//! when another connection commits. This thread watches it, and when it
//! moves:
//!
//! - the library re-queries, and the vault mirror flushes what changed, as
//!   after any write of the app's own;
//! - the new rows of the agent activity trace (`agent_activity`, core
//!   `store/activity.rs`) go to the webview as `library:external-change`,
//!   which draws them on the notes themselves and in the activity panel.
//!
//! An agent's read changes no note, but the server traces every call, and
//! that row is what makes a read visible here too. The watcher's cursor is
//! the newest `seq` it has announced: one indexed lookup per poll.

use crate::*;
use instantnotes_core::store::activity::{AgentActivity, NoteSnapshot};
use std::path::PathBuf;
use std::time::Duration;

/// How often `data_version` is read: a lock and one pragma, well under a
/// millisecond, and quick enough for a highlight to feel live.
const POLL: Duration = Duration::from_millis(400);
/// Rows announced per poll at most; a burst past this is caught up next poll.
const BATCH: i64 = 200;

/// What Settings > Agents needs to print a working connect command.
pub(crate) struct AgentBridge {
    db_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnection {
    /// This app's executable, which is also the MCP server.
    exe: String,
    db: String,
    attachments: Option<String>,
}

/// Start the watcher; manage the returned bridge.
pub(crate) fn start_agent_watcher(app: &AppHandle, db_path: PathBuf) -> AgentBridge {
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut last_version: Option<i64> = None;
        let mut last_seq: i64 = 0;
        loop {
            if let Some((version, newest)) = read_state(&handle) {
                match last_version {
                    // History from before launch is not news.
                    None => last_seq = newest,
                    Some(v) if v != version => {
                        if let Some(fresh) = fresh_rows(&handle, last_seq) {
                            if let Some(e) = fresh.last() {
                                last_seq = e.seq;
                            }
                            announce(&handle, fresh);
                        }
                    }
                    // Rows this connection wrote itself (a revert): already
                    // announced by the command, so only move the cursor.
                    _ if newest > last_seq => last_seq = newest,
                    _ => {}
                }
                last_version = Some(version);
            }
            std::thread::sleep(POLL);
        }
    });
    AgentBridge { db_path }
}

fn read_state(app: &AppHandle) -> Option<(i64, i64)> {
    let state = app.try_state::<AppState>()?;
    let store = state.store.lock().ok()?;
    let version = store.data_version().ok()?;
    let newest = store.latest_activity_seq().ok()?;
    Some((version, newest))
}

fn fresh_rows(app: &AppHandle, after_seq: i64) -> Option<Vec<AgentActivity>> {
    let state = app.try_state::<AppState>()?;
    let store = state.store.lock().ok()?;
    store.activity_since(after_seq, BATCH).ok()
}

fn announce(app: &AppHandle, fresh: Vec<AgentActivity>) {
    if library_changed(&fresh) {
        emit_notes_changed(app);
        emit_tags_changed(app);
        emit_workspaces_changed(app);
    }
    let _ = app.emit(events::LIBRARY_EXTERNAL_CHANGE, fresh);
}

/// Whether a move of `data_version` changed the library itself, given the
/// rows not yet announced. Reads and searches change no note, so nothing
/// needs re-querying; a move with no new row at all is a write from
/// elsewhere (a second copy of the app), and does.
fn library_changed(fresh: &[AgentActivity]) -> bool {
    fresh.is_empty() || fresh.iter().any(|e| e.kind == "write" && e.status == "ok")
}

/// The executable and library an agent should be pointed at.
#[tauri::command(async)]
pub fn agent_connection(
    app: AppHandle,
    bridge: State<'_, AgentBridge>,
) -> CmdResult<AgentConnection> {
    let exe = std::env::current_exe()
        .map_err(|e| CmdError::storage(format!("cannot locate the app: {e}")))?;
    Ok(AgentConnection {
        exe: exe.to_string_lossy().into_owned(),
        db: bridge.db_path.to_string_lossy().into_owned(),
        attachments: attachments_dir(&app)
            .ok()
            .map(|d| d.to_string_lossy().into_owned()),
    })
}

/// The trace, newest first.
#[tauri::command(async)]
pub fn list_agent_activity(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> CmdResult<Vec<AgentActivity>> {
    Ok(locked(&state)?.list_activity(limit.unwrap_or(200), offset.unwrap_or(0))?)
}

/// The note as it was before a write, for a preview of what reverting it
/// restores; `null` for a create.
#[tauri::command(async)]
pub fn agent_activity_before(
    state: State<'_, AppState>,
    seq: i64,
) -> CmdResult<Option<NoteSnapshot>> {
    Ok(locked(&state)?.activity_before(seq)?)
}

/// Undo one agent write. The revert is itself a traced write, so the trace
/// shows it and it can be reverted in turn. Returns the revert row.
#[tauri::command(async)]
pub fn revert_agent_activity(
    state: State<'_, AppState>,
    app: AppHandle,
    seq: i64,
) -> CmdResult<AgentActivity> {
    let row = {
        let mut store = locked(&state)?;
        let new_seq = store.revert_activity(seq)?;
        store
            .activity_since(new_seq - 1, 1)?
            .into_iter()
            .next()
            .ok_or_else(|| CmdError::storage("the revert left no trace"))?
    };
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    emit_workspaces_changed(&app);
    // The app's own write: the watcher does not see it (same connection), so
    // tell the webview directly, the way an agent's row would arrive.
    let _ = app.emit(events::LIBRARY_EXTERNAL_CHANGE, vec![row.clone()]);
    Ok(row)
}

/// Forget the trace. Notes are untouched.
#[tauri::command(async)]
pub fn clear_agent_activity(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(locked(&state)?.clear_activity()?)
}

#[cfg(test)]
mod tests {
    use super::library_changed;
    use instantnotes_core::store::activity::AgentActivity;

    fn entry(seq: i64, kind: &str, status: &str) -> AgentActivity {
        AgentActivity {
            seq,
            at: seq,
            session: "s".into(),
            client: "c".into(),
            tool: "t".into(),
            kind: kind.into(),
            status: status.into(),
            error: None,
            duration_ms: 0,
            note_ids: vec![],
            note_count: 0,
            titles: vec![],
            space: None,
            tag: None,
            query: None,
            after_updated_at: None,
            revertable: false,
            reverted_at: None,
            reverts: None,
        }
    }

    #[test]
    fn reads_and_searches_alone_do_not_requery_the_library() {
        assert!(!library_changed(&[
            entry(1, "read", "ok"),
            entry(2, "search", "ok")
        ]));
    }

    #[test]
    fn a_successful_write_requeries_the_library() {
        assert!(library_changed(&[
            entry(1, "read", "ok"),
            entry(2, "write", "ok")
        ]));
    }

    #[test]
    fn a_failed_write_changed_nothing() {
        assert!(!library_changed(&[entry(1, "write", "error")]));
    }

    #[test]
    fn a_change_no_agent_traced_is_a_write_from_elsewhere() {
        assert!(
            library_changed(&[]),
            "a second copy of the app wrote; re-query"
        );
    }
}
