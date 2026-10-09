//! The app's side of agent access (`instantnotes-agents`). An agent writes
//! through its own process and connection, so the app learns of it the way
//! SQLite reports it: `data_version` moves only when another connection
//! commits. This thread watches it, and when it moves:
//!
//! - the library re-queries, and the vault mirror flushes what changed, as
//!   after any write of the app's own;
//! - the new rows of the agent activity trace (`agent_activity`, core
//!   `store/activity.rs`) go to the webview as `library:external-change`,
//!   which draws them on the notes themselves and in the Agents Space;
//! - who is connected goes to the webview as `agents:sessions` whenever it
//!   changes, an agent that died without saying so included.
//!
//! An agent's read changes no note, but the server traces every call, and
//! that row is what makes a read visible here too.

use crate::*;
use instantnotes_core::clients::{self, Client};
use instantnotes_core::store::activity::{
    session_alive, ActivityWire, AgentActivity, AgentSession, ClientSession, NoteSnapshot,
};
use instantnotes_core::store::now_ms;
use instantnotes_core::Store;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

/// How often `data_version` is read: a lock and one pragma, cheap enough
/// for a highlight to feel live.
const POLL: Duration = Duration::from_millis(400);
/// Rows announced per poll at most; a burst past this is caught up next poll.
const BATCH: i64 = 200;
/// Polls between looks at who is connected: a file probe per open
/// connection, so a little slower than the trace.
const PRESENCE_EVERY: u32 = 5;
const SESSIONS: i64 = 200;

/// A connection as the webview shows it.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionView {
    #[serde(flatten)]
    session: AgentSession,
    /// The process is alive right now: it still holds its lock.
    connected: bool,
}

/// Every known connection, newest first. A row still open whose process no
/// longer holds its lock died without saying so, and is closed here.
fn sessions(store: &mut Store, db: &Path) -> Vec<AgentSessionView> {
    let rows = store.list_agent_sessions(SESSIONS).unwrap_or_default();
    rows.into_iter()
        .map(|mut session| {
            let connected =
                session.disconnected_at.is_none() && session_alive(db, &session.session);
            if !connected && session.disconnected_at.is_none() {
                let _ = store.close_agent_session(&session.session);
                session.disconnected_at = Some(now_ms());
            }
            // A connected client may rename its session at any time; follow it,
            // and keep what was last seen for after it has gone.
            if connected {
                let now = Client::from_name(&session.client).and_then(|client| {
                    clients::current(
                        client,
                        session.client_pid,
                        session.client_session.as_deref(),
                    )
                });
                if let Some(now) = now {
                    let renamed = now.label.is_some() && now.label != session.label;
                    let resumed = now.id.is_some() && now.id != session.client_session;
                    if renamed || resumed {
                        let about = ClientSession {
                            label: now.label.clone(),
                            client_session: now.id.clone(),
                            ..Default::default()
                        };
                        let _ = store.describe_agent_session(&session.session, &about);
                        session.label = now.label.or(session.label);
                        session.client_session = now.id.or(session.client_session);
                    }
                }
            }
            AgentSessionView { session, connected }
        })
        .collect()
}

fn read_sessions(app: &AppHandle, db: &Path) -> Option<Vec<AgentSessionView>> {
    let state = app.try_state::<AppState>()?;
    let mut store = state.store.lock().ok()?;
    Some(sessions(&mut store, db))
}

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
    let db = db_path.clone();
    std::thread::spawn(move || {
        let mut last_version: Option<i64> = None;
        let mut last_seq: i64 = 0;
        let mut last_sessions: Option<Vec<AgentSessionView>> = None;
        let mut polls: u32 = 0;
        loop {
            // Who is connected: looked at when another process wrote (a
            // connect or a goodbye is a write) and every few polls besides,
            // which is what catches an agent that died without a word.
            let moved = read_state(&handle).map(|(v, _)| Some(v) != last_version);
            if moved == Some(true) || polls.is_multiple_of(PRESENCE_EVERY) {
                if let Some(now) = read_sessions(&handle, &db) {
                    if last_sessions.as_ref() != Some(&now) {
                        let _ = handle.emit(events::AGENT_SESSIONS, now.clone());
                        last_sessions = Some(now);
                    }
                }
            }
            polls = polls.wrapping_add(1);
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
/// rows not yet announced. Reads and searches change no note; a move with
/// no new row at all is a write from elsewhere (a second copy of the app).
fn library_changed(fresh: &[AgentActivity]) -> bool {
    fresh.is_empty() || fresh.iter().any(|e| e.kind == "write" && e.status == "ok")
}

#[tauri::command(async)]
pub fn agent_connection(
    app: AppHandle,
    bridge: State<'_, AgentBridge>,
) -> CmdResult<AgentConnection> {
    #[cfg(target_os = "linux")]
    let appimage = app.env().appimage.map(std::path::PathBuf::from);
    #[cfg(not(target_os = "linux"))]
    let appimage = None;
    let exe = agent_exe(appimage)?;
    Ok(AgentConnection {
        exe: exe.to_string_lossy().into_owned(),
        db: bridge.db_path.to_string_lossy().into_owned(),
        attachments: attachments_dir(&app)
            .ok()
            .map(|d| d.to_string_lossy().into_owned()),
    })
}

/// The program an agent should run. Inside an AppImage, `current_exe()` is the
/// binary in the AppImage's FUSE mount (`/tmp/.mount_*`), which is gone once
/// the app quits; a snippet naming it fails on the next restart. The AppImage
/// file itself stays put and runs `mcp` the same way.
fn agent_exe(appimage: Option<std::path::PathBuf>) -> CmdResult<std::path::PathBuf> {
    match appimage {
        Some(path) => Ok(path),
        None => std::env::current_exe()
            .map_err(|e| CmdError::storage(format!("cannot locate the app: {e}"))),
    }
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

/// Every known agent connection, newest first, each with whether its process
/// is alive right now.
#[tauri::command(async)]
pub fn list_agent_sessions(
    state: State<'_, AppState>,
    bridge: State<'_, AgentBridge>,
) -> CmdResult<Vec<AgentSessionView>> {
    let mut store = locked(&state)?;
    Ok(sessions(&mut store, &bridge.db_path))
}

/// The raw exchange behind a traced call: the JSON-RPC request and response,
/// each as JSON text, or `null` where none was kept.
#[tauri::command(async)]
pub fn agent_activity_wire(state: State<'_, AppState>, seq: i64) -> CmdResult<ActivityWire> {
    Ok(locked(&state)?.activity_wire(seq)?)
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

#[tauri::command(async)]
pub fn end_agent_session(bridge: State<'_, AgentBridge>, session: String) -> CmdResult<()> {
    let pid = session_pid(&session)
        .filter(|&pid| serves_agents(pid))
        .ok_or_else(|| CmdError::validation("not an agent session"))?;
    if !session_alive(&bridge.db_path, &session) {
        return Err(CmdError::validation("that agent is no longer connected"));
    }
    match end_process(pid) {
        Ok(status) if status.success() => Ok(()),
        _ => Err(CmdError::storage("could not end the agent's session")),
    }
}

fn session_pid(session: &str) -> Option<u32> {
    let (pid, started) = session.split_once('-')?;
    u64::from_str_radix(started, 16).ok()?;
    u32::from_str_radix(pid, 16).ok().filter(|&pid| pid > 1)
}

#[cfg(target_os = "linux")]
fn serves_agents(pid: u32) -> bool {
    std::fs::read(format!("/proc/{pid}/cmdline"))
        .is_ok_and(|args| args.split(|&b| b == 0).nth(1) == Some(b"mcp".as_slice()))
}

#[cfg(not(target_os = "linux"))]
fn serves_agents(_pid: u32) -> bool {
    true
}

#[cfg(unix)]
fn end_process(pid: u32) -> std::io::Result<std::process::ExitStatus> {
    std::process::Command::new("kill")
        .arg(pid.to_string())
        .status()
}

#[cfg(windows)]
fn end_process(pid: u32) -> std::io::Result<std::process::ExitStatus> {
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status()
}

/// Forget the trace. Notes are untouched.
#[tauri::command(async)]
pub fn clear_agent_activity(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(locked(&state)?.clear_activity()?)
}

#[cfg(test)]
mod tests {
    use super::{agent_exe, library_changed, session_pid};

    #[test]
    fn the_pid_comes_from_the_session_id_and_nothing_else() {
        assert_eq!(session_pid("1f4a-19a0c3e2b11"), Some(0x1f4a));
        assert_eq!(session_pid("1"), None);
        assert_eq!(session_pid("1-19a0c3e2b11"), None);
        assert_eq!(session_pid("zz-19a0c3e2b11"), None);
        assert_eq!(session_pid("1f4a-later"), None);
        assert_eq!(session_pid("agent-session:1f4a-19a0"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn only_a_process_serving_agents_may_be_ended() {
        assert!(!super::serves_agents(std::process::id()));
        assert!(!super::serves_agents(1));
    }
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

    #[test]
    fn an_appimage_is_named_by_its_file_not_its_mount() {
        let appimage = std::path::PathBuf::from("/home/u/Applications/InstantNotes.AppImage");
        assert_eq!(agent_exe(Some(appimage.clone())).unwrap(), appimage);
        assert_eq!(agent_exe(None).unwrap(), std::env::current_exe().unwrap());
    }
}
