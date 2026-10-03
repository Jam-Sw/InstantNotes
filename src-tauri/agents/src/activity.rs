//! The trace of agent calls, kept in the `agent_activity` table (core
//! `store/activity.rs`). Writing it is also what tells the app anything
//! happened: a read changes no note, but this row moves SQLite's
//! `data_version`.
//!
//! A write's row carries the note as it was just before, so the app can
//! revert it. Failed calls are recorded too (`status: "error"`).

use instantnotes_core::store::activity::{ActivityRecord, NoteSnapshot};
use instantnotes_core::Store;
use serde_json::Value;
use std::time::Instant;

/// Ids recorded per call; enough to light up a full page of results.
const NOTE_IDS: usize = 50;
const TITLES: usize = 3;
/// Error text kept in the trace. Enough to read, never a whole note.
const ERROR_CHARS: usize = 200;

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

pub(crate) struct Scope {
    space: Option<String>,
    tag: Option<String>,
    query: Option<String>,
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

    /// Best effort: a write is never refused because its trace could not be
    /// prepared, it just becomes non-revertable.
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

    /// Returns the row's `seq`. Best effort: an agent's call never fails
    /// because its trace could not be written.
    pub(crate) fn finish(
        self,
        store: &mut Store,
        session: &str,
        client: &str,
        result: &Result<Value, String>,
    ) -> Option<i64> {
        let elapsed_ms = self.started.elapsed().as_millis() as i64;
        store
            .record_activity(record_for(self, session, client, result, elapsed_ms))
            .ok()
    }
}

/// A failed write changed nothing, so it keeps no snapshot; a failed call
/// still names the note it was about.
fn record_for(
    trace: Trace,
    session: &str,
    client: &str,
    result: &Result<Value, String>,
    elapsed_ms: i64,
) -> ActivityRecord {
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
            trace
                .scope
                .id
                .iter()
                .map(|id| (id.clone(), String::new()))
                .collect(),
            None,
        ),
    };
    let before = if status == "ok" { trace.before } else { None };
    ActivityRecord {
        session: session.to_string(),
        client: client.to_string(),
        tool: trace.tool.to_string(),
        kind: trace.kind.as_str().to_string(),
        status: status.to_string(),
        error,
        duration_ms: elapsed_ms,
        note_ids: notes
            .iter()
            .take(NOTE_IDS)
            .map(|(id, _)| id.clone())
            .collect(),
        note_count: notes.len() as i64,
        titles: notes.iter().take(TITLES).map(|(_, t)| t.clone()).collect(),
        space: trace.scope.space,
        tag: trace.scope.tag,
        query: trace.scope.query,
        after_updated_at: after,
        before,
        reverts: None,
    }
}

/// The notes a result is about: the note itself, or every one in a list.
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

#[cfg(test)]
mod tests {
    //! The row's rules on plain values: no store.
    use super::*;
    use serde_json::json;

    fn snapshot(id: &str) -> NoteSnapshot {
        NoteSnapshot {
            id: id.into(),
            title: "Before".into(),
            title_is_auto: true,
            body: "before".into(),
            is_pinned: false,
            is_archived: false,
            is_deleted: false,
            deleted_at: None,
            updated_at: "2026-09-01T00:00:00.000000Z".into(),
            tags: vec![],
            spaces: vec![],
        }
    }

    fn trace(tool: &'static str, kind: Kind, args: Value) -> Trace {
        Trace::start(tool, kind, Scope::of(&args))
    }

    #[test]
    fn an_ok_result_records_every_note_it_touched() {
        let t = trace("list_notes", Kind::Read, json!({ "space": "Work" }));
        let result = Ok(json!({
            "notes": [
                { "id": "n1", "title": "One" },
                { "id": "n2", "title": "Two" }
            ]
        }));
        let rec = record_for(t, "s1", "claude-code", &result, 12);
        assert_eq!(rec.status, "ok");
        assert_eq!(rec.error, None);
        assert_eq!(rec.kind, "read");
        assert_eq!(rec.tool, "list_notes");
        assert_eq!(rec.session, "s1");
        assert_eq!(rec.client, "claude-code");
        assert_eq!(rec.duration_ms, 12);
        assert_eq!(rec.note_ids, vec!["n1", "n2"]);
        assert_eq!(rec.titles, vec!["One", "Two"]);
        assert_eq!(rec.note_count, 2);
        assert_eq!(rec.space.as_deref(), Some("Work"));
        assert_eq!(rec.after_updated_at, None);
        assert_eq!(rec.reverts, None);
    }

    #[test]
    fn a_write_keeps_its_snapshot_and_the_note_s_new_updated_at() {
        let mut t = trace("update_note", Kind::Write, json!({ "id": "n1" }));
        t.before = Some(Some(snapshot("n1")));
        let result =
            Ok(json!({ "id": "n1", "title": "After", "updatedAt": "2026-09-02T00:00:00.000000Z" }));
        let rec = record_for(t, "s1", "codex", &result, 3);
        assert_eq!(rec.status, "ok");
        assert_eq!(rec.note_ids, vec!["n1"]);
        assert_eq!(rec.titles, vec!["After"]);
        assert_eq!(
            rec.after_updated_at.as_deref(),
            Some("2026-09-02T00:00:00.000000Z")
        );
        assert_eq!(rec.before, Some(Some(snapshot("n1"))));
    }

    #[test]
    fn an_error_names_the_note_the_call_was_about() {
        let t = trace("get_note", Kind::Read, json!({ "id": "n9" }));
        let result = Err("NOT_FOUND: note n9 not found".to_string());
        let rec = record_for(t, "s1", "claude-code", &result, 1);
        assert_eq!(rec.status, "error");
        assert_eq!(rec.error.as_deref(), Some("NOT_FOUND: note n9 not found"));
        assert_eq!(rec.note_ids, vec!["n9"]);
        assert_eq!(rec.titles, vec![""]);
        assert_eq!(rec.note_count, 1);
        assert_eq!(rec.after_updated_at, None);
    }

    #[test]
    fn a_failed_write_drops_its_snapshot() {
        let mut t = trace("update_note", Kind::Write, json!({ "id": "n1" }));
        t.before = Some(Some(snapshot("n1")));
        let rec = record_for(t, "s1", "codex", &Err("CONFLICT: changed".into()), 2);
        assert_eq!(rec.status, "error");
        assert_eq!(rec.before, None);
    }

    #[test]
    fn long_results_and_messages_are_cut_to_what_the_row_keeps() {
        let notes: Vec<Value> = (0..60)
            .map(|i| json!({ "id": format!("n{i}"), "title": format!("T{i}") }))
            .collect();
        let t = trace("search_notes", Kind::Search, json!({ "query": "x" }));
        let rec = record_for(t, "s1", "claude-code", &Ok(json!({ "results": notes })), 5);
        assert_eq!(rec.note_ids.len(), NOTE_IDS);
        assert_eq!(rec.note_ids[0], "n0");
        assert_eq!(rec.titles.len(), TITLES);
        assert_eq!(rec.note_count, 60);
        assert_eq!(rec.query.as_deref(), Some("x"));

        let t = trace("get_note", Kind::Read, json!({ "id": "n1" }));
        let long = "e".repeat(ERROR_CHARS + 50);
        let rec = record_for(t, "s1", "claude-code", &Err(long), 1);
        assert_eq!(rec.error.map(|e| e.chars().count()), Some(ERROR_CHARS));
    }
}
