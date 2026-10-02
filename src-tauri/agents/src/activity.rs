//! The trace of agent calls, kept in the library's `agent_activity` table
//! (core `store/activity.rs`) where the app reads it to show, on the notes
//! themselves and in its Agents Space, what an agent looked at or changed.
//! Writing it is also what tells the app anything happened: a read changes
//! no note, but this row moves SQLite's `data_version`.
//!
//! A write's row carries the note as it was just before, so the app can
//! revert it. Failed calls are recorded too (`status: "error"`): a user who
//! sees an agent fumbling can tell what it tried.

use instantnotes_core::store::activity::{ActivityRecord, NoteSnapshot};
use instantnotes_core::Store;
use serde_json::Value;
use std::time::Instant;

/// Ids recorded per call; enough to light up a full page of results.
const NOTE_IDS: usize = 50;
const TITLES: usize = 3;
/// Error text kept in the trace. Enough to read, never a whole note.
const ERROR_CHARS: usize = 200;

/// What kind of thing a call is, for the app's eye.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Read,
    Search,
    Write,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Read => "read",
            Kind::Search => "search",
            Kind::Write => "write",
        }
    }
}

/// Where a call looked, from its arguments.
pub(crate) struct Scope {
    space: Option<String>,
    tag: Option<String>,
    query: Option<String>,
    /// The note the call names, when it names one.
    pub(crate) id: Option<String>,
}

impl Scope {
    pub(crate) fn of(args: &Value) -> Scope {
        let field = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
        Scope {
            space: field("space"),
            tag: field("tag"),
            query: field("query"),
            id: field("id"),
        }
    }
}

/// One call being traced: started when the tool is dispatched, finished
/// with its outcome.
pub(crate) struct Trace {
    started: Instant,
    tool: &'static str,
    kind: Kind,
    scope: Scope,
    /// For a write: the note before, or `Some(None)` when it did not exist.
    before: Option<Option<NoteSnapshot>>,
}

impl Trace {
    pub(crate) fn start(tool: &'static str, kind: Kind, scope: Scope) -> Trace {
        Trace {
            started: Instant::now(),
            tool,
            kind,
            scope,
            before: None,
        }
    }

    /// Take the snapshot a write will be reverted to. Best effort: a write
    /// is never refused because its trace could not be prepared, it just
    /// becomes non-revertable.
    pub(crate) fn snapshot(&mut self, store: &Store) {
        if self.kind != Kind::Write {
            return;
        }
        self.before = match &self.scope.id {
            Some(id) => store.snapshot_note(id).ok(),
            // A create: no note yet. Reverting trashes what gets created.
            None => Some(None),
        };
    }

    /// Record the outcome; returns the row's `seq`. Best effort: an agent's
    /// call never fails because its trace could not be written.
    pub(crate) fn finish(
        self,
        store: &mut Store,
        session: &str,
        client: &str,
        result: &Result<Value, String>,
    ) -> Option<i64> {
        let (status, error, notes, after) = match result {
            Ok(value) => {
                let notes = touched_notes(value);
                let after = value
                    .get("updatedAt")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                ("ok", None, notes, after)
            }
            Err(message) => (
                "error",
                Some(message.chars().take(ERROR_CHARS).collect::<String>()),
                // The note it was about, so the row still points somewhere.
                self.scope
                    .id
                    .iter()
                    .map(|id| (id.clone(), String::new()))
                    .collect(),
                None,
            ),
        };
        // A failed write changed nothing: no snapshot to go back to.
        let before = if status == "ok" { self.before } else { None };
        store
            .record_activity(ActivityRecord {
                session: session.to_string(),
                client: client.to_string(),
                tool: self.tool.to_string(),
                kind: self.kind.as_str().to_string(),
                status: status.to_string(),
                error,
                duration_ms: self.started.elapsed().as_millis() as i64,
                note_ids: notes
                    .iter()
                    .take(NOTE_IDS)
                    .map(|(id, _)| id.clone())
                    .collect(),
                note_count: notes.len() as i64,
                titles: notes.iter().take(TITLES).map(|(_, t)| t.clone()).collect(),
                space: self.scope.space,
                tag: self.scope.tag,
                query: self.scope.query,
                after_updated_at: after,
                before,
                reverts: None,
            })
            .ok()
    }
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
