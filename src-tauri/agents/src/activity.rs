//! The trace of agent calls, kept in the library where the app reads it to
//! show, on the notes themselves, what an agent is looking at or changing.
//! Writing it is also what tells the app anything happened: a read changes
//! no note, but this row moves SQLite's `data_version`.

use instantnotes_core::Store;
use serde_json::{json, Value};

/// Settings key holding the most recent agent calls, newest first.
pub const ACTIVITY_KEY: &str = "agents.activity";
const KEEP: usize = 30;
/// Ids recorded per call; enough to light up a full page of results.
const NOTE_IDS: usize = 50;
const TITLES: usize = 3;

/// Where a call looked, from its arguments.
pub(crate) struct Scope {
    space: Option<String>,
    tag: Option<String>,
    query: Option<String>,
}

impl Scope {
    pub(crate) fn of(args: &Value) -> Scope {
        let field = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
        Scope {
            space: field("space"),
            tag: field("tag"),
            query: field("query"),
        }
    }
}

/// Record one successful call. Best effort: an agent's call never fails
/// because its trace could not be written.
pub(crate) fn record(
    store: &mut Store,
    client: &str,
    tool: &str,
    wrote: bool,
    scope: &Scope,
    result: &Value,
) {
    let notes = touched_notes(result);
    let entry = json!({
        "at": now_ms(),
        "client": client,
        "tool": tool,
        "kind": if wrote { "write" } else { "read" },
        "noteIds": notes.iter().take(NOTE_IDS).map(|(id, _)| id).collect::<Vec<_>>(),
        "noteCount": notes.len(),
        "titles": notes.iter().take(TITLES).map(|(_, t)| t).collect::<Vec<_>>(),
        "space": scope.space,
        "tag": scope.tag,
        "query": scope.query,
    });
    let mut log = match store.get_setting(ACTIVITY_KEY) {
        Ok(Some(Value::Array(log))) => log,
        _ => Vec::new(),
    };
    log.insert(0, entry);
    log.truncate(KEEP);
    let _ = store.set_setting(ACTIVITY_KEY, Value::Array(log));
}

/// The notes a result is about, as (id, title): the note itself, or every
/// note in a list or search result.
fn touched_notes(result: &Value) -> Vec<(String, String)> {
    let pair = |v: &Value| {
        let id = v.get("id").and_then(Value::as_str)?;
        let title = v.get("title").and_then(Value::as_str).unwrap_or_default();
        Some((id.to_string(), title.to_string()))
    };
    if let Some(one) = pair(result) {
        return vec![one];
    }
    ["notes", "results"]
        .iter()
        .filter_map(|k| result.get(*k).and_then(Value::as_array))
        .flatten()
        .filter_map(pair)
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
