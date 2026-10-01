//! The app's side of agent access (`instantnotes-agents`). An agent writes
//! through its own process and its own connection to the library, so the
//! app learns of it the way SQLite reports it: `data_version` moves only
//! when another connection commits. This thread watches it, and when it
//! moves:
//!
//! - the library re-queries, and the vault mirror flushes what changed, as
//!   after any write of the app's own;
//! - the new entries of the agent activity log go to the webview as
//!   `library:external-change`, which draws them on the notes themselves.
//!
//! An agent's read changes no note, but the server records every call in
//! the activity log, and that write is what makes a read visible here too.

use crate::*;
use instantnotes_agents::ACTIVITY_KEY;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

/// How often `data_version` is read: a lock and one pragma, well under a
/// millisecond, and quick enough for a highlight to feel live.
const POLL: Duration = Duration::from_millis(400);

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
        let mut last = Seen::default();
        let mut first = true;
        loop {
            if let Some(now) = read_state(&handle) {
                if first {
                    // History from before launch is not news.
                    first = false;
                } else if now.version != last.version {
                    announce(&handle, &now, last.newest_at);
                }
                last = now;
            }
            std::thread::sleep(POLL);
        }
    });
    AgentBridge { db_path }
}

#[derive(Default)]
struct Seen {
    version: i64,
    /// `at` of the newest activity entry seen, so each is announced once.
    newest_at: u64,
    log: Vec<Value>,
}

fn read_state(app: &AppHandle) -> Option<Seen> {
    let state = app.try_state::<AppState>()?;
    let store = state.store.lock().ok()?;
    let version = store.data_version().ok()?;
    let log = match store.get_setting(ACTIVITY_KEY) {
        Ok(Some(Value::Array(log))) => log,
        _ => Vec::new(),
    };
    let newest_at = log.first().map(entry_at).unwrap_or_default();
    Some(Seen {
        version,
        newest_at,
        log,
    })
}

fn entry_at(entry: &Value) -> u64 {
    entry.get("at").and_then(Value::as_u64).unwrap_or_default()
}

fn announce(app: &AppHandle, now: &Seen, seen_at: u64) {
    let (fresh, wrote) = news(&now.log, seen_at);
    if wrote {
        emit_notes_changed(app);
        emit_tags_changed(app);
        emit_workspaces_changed(app);
    }
    let _ = app.emit(events::LIBRARY_EXTERNAL_CHANGE, fresh);
}

/// What a move of `data_version` means, given the activity log (newest
/// first) and the newest entry already announced: the entries not yet
/// announced, oldest first so the webview plays them in order, and whether
/// the library itself changed. Only reads since the last look change no
/// note, so nothing needs re-querying; a move with no new entry at all is a
/// write from elsewhere (a second copy of the app), and does.
fn news(log: &[Value], seen_at: u64) -> (Vec<&Value>, bool) {
    let mut fresh: Vec<&Value> = log.iter().take_while(|e| entry_at(e) > seen_at).collect();
    fresh.reverse();
    let wrote = fresh.is_empty()
        || fresh
            .iter()
            .any(|e| e.get("kind").and_then(Value::as_str) == Some("write"));
    (fresh, wrote)
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

#[cfg(test)]
mod tests {
    use super::news;
    use serde_json::{json, Value};

    fn entry(at: u64, kind: &str) -> Value {
        json!({ "at": at, "kind": kind })
    }

    fn ats(entries: &[&Value]) -> Vec<u64> {
        entries.iter().map(|e| e["at"].as_u64().unwrap()).collect()
    }

    #[test]
    fn new_entries_come_oldest_first_and_each_only_once() {
        let log = [entry(30, "read"), entry(20, "read"), entry(10, "read")];
        let (fresh, _) = news(&log, 10);
        assert_eq!(ats(&fresh), [20, 30]);
        let (fresh, _) = news(&log, 30);
        assert!(fresh.is_empty(), "already announced");
    }

    #[test]
    fn reads_alone_do_not_requery_the_library() {
        let log = [entry(2, "read"), entry(1, "read")];
        assert!(!news(&log, 0).1);
    }

    #[test]
    fn any_write_requeries_the_library() {
        let log = [entry(3, "read"), entry(2, "write"), entry(1, "read")];
        assert!(news(&log, 1).1);
        // The write was already announced; the new read alone changes nothing.
        assert!(!news(&log, 2).1);
    }

    #[test]
    fn a_change_no_agent_logged_is_a_write_from_elsewhere() {
        let log = [entry(5, "read")];
        let (fresh, wrote) = news(&log, 5);
        assert!(fresh.is_empty());
        assert!(wrote, "a second copy of the app wrote; re-query");
    }
}
