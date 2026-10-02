//! The tools an agent can call: what each one is, as `tools/list` describes
//! it, and what it does.
//!
//! Every tool maps onto a public `Store` method, so an agent's write goes
//! through the same rules as a keystroke in the app. The surface says
//! "space" (the product term); the core underneath says "workspace".
//!
//! Deliberately absent, at every access level: permanent delete, settings,
//! the vault, and whiteboard canvases.

use crate::access::Access;
use crate::activity::{Kind, Scope, Trace};
use crate::fail;
use instantnotes_core::domain::{normalize_tag_name, normalize_workspace_name};
use instantnotes_core::types::{
    CreateNoteInput, Note, NoteFilter, UpdateNotePatch, CONTENT_KIND_WHITEBOARD,
};
use instantnotes_core::{AppError, Store};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

/// How many notes `resources/list` offers: the recent ones, as an index.
const RESOURCE_LIST: i64 = 50;
/// The URI scheme a note is read under.
pub(crate) const NOTE_URI_PREFIX: &str = "instantnotes://notes/";

const SNIPPET_CHARS: usize = 160;
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
/// append_to_note re-reads and retries when the user saves in between.
const APPEND_ATTEMPTS: usize = 3;
/// A capture is an open loop once it has gone unopened this long. Matches
/// `REVISIT_AFTER_MS` in src/lib/stores/library.svelte.ts.
const REVISIT_AFTER_MS: i64 = 3 * 24 * 60 * 60 * 1000;

type ToolResult = Result<Value, String>;

pub(crate) struct Tools<'a> {
    store: &'a mut Store,
    attachments_dir: Option<PathBuf>,
    /// `clientInfo.name` from `initialize`, shown to the user as who is
    /// acting ("claude-code", "cursor").
    client: String,
    /// This process, in the trace: one agent conversation's calls group
    /// under it.
    session: String,
    /// The trace row of the call just made, until the transport attaches the
    /// raw messages to it.
    traced: Option<i64>,
}

struct ToolDef {
    name: &'static str,
    /// Shown to the user by clients that display tools.
    title: &'static str,
    level: Access,
    /// MCP `destructiveHint`, for writes: the tool can remove or replace
    /// something, rather than only add. Undoable still counts.
    destructive: bool,
    /// MCP `idempotentHint`, for writes: repeating the call with the same
    /// arguments changes nothing more.
    idempotent: bool,
    description: &'static str,
    schema: fn() -> Value,
}

const TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "search_notes",
        title: "Search notes",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Full-text search over note titles and bodies; a note's exact title finds it first. Returns ids, titles, spaces, a matching excerpt, and updatedAt (enough to call update_note directly).",
        schema: || object(json!({
            "query": { "type": "string", "description": "Words to search for." },
            "limit": limit_param()
        }), &["query"]),
    },
    ToolDef {
        name: "list_notes",
        title: "List notes",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "List notes, most recently updated first, optionally within a space or tag. Returns summaries, not full bodies.",
        schema: || object(json!({
            "space": space_param(),
            "tag": tag_param(),
            "status": {
                "type": "string",
                "enum": ["active", "pinned", "archived", "trash", "revisit"],
                "default": "active",
                "description": "revisit: open loops, captures never opened in the app and older than three days, oldest first."
            },
            "limit": limit_param(),
            "offset": { "type": "integer", "minimum": 0, "default": 0 }
        }), &[]),
    },
    ToolDef {
        name: "get_note",
        title: "Read a note",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Read one note in full: body, tags, spaces, and updatedAt (pass it to update_note). Reading does not mark the note as opened.",
        schema: || object(json!({ "id": id_param() }), &["id"]),
    },
    ToolDef {
        name: "list_tags",
        title: "List tags",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Every tag with how many notes use it.",
        schema: || object(json!({}), &[]),
    },
    ToolDef {
        name: "list_spaces",
        title: "List Spaces",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Every space with how many notes it holds.",
        schema: || object(json!({}), &[]),
    },
    ToolDef {
        name: "create_note",
        title: "Create a note",
        level: Access::Write,
        destructive: false,
        idempotent: false,
        description: "Create a note. The title is taken from the first line unless given. #words in the body become tags.",
        schema: || object(json!({
            "body": { "type": "string", "description": "Markdown." },
            "title": { "type": "string", "description": "Only to override the first line as the title." },
            "tags": { "type": "array", "items": tag_param() },
            "space": { "type": "string", "description": "Space to file it in; created if new." }
        }), &["body"]),
    },
    ToolDef {
        name: "update_note",
        title: "Rewrite a note",
        level: Access::Write,
        destructive: true,
        idempotent: true,
        description: "Replace a note's title and/or body. expectedUpdatedAt is the updatedAt from search_notes, list_notes, or get_note; no need to read the note first. A CONFLICT means the user changed it since, and carries the current note to retry from. Returns the note without its body.",
        schema: || object(json!({
            "id": id_param(),
            "expectedUpdatedAt": { "type": "string", "description": "The note's updatedAt, exactly as search_notes, list_notes, or get_note returned it." },
            "title": { "type": "string" },
            "body": { "type": "string", "description": "Markdown; replaces the whole body." }
        }), &["id", "expectedUpdatedAt"]),
    },
    ToolDef {
        name: "append_to_note",
        title: "Add to a note",
        level: Access::Write,
        destructive: false,
        idempotent: false,
        description: "Add text to the end of a note on a new line, without replacing what is there.",
        schema: || object(json!({
            "id": id_param(),
            "text": { "type": "string", "description": "Markdown." }
        }), &["id", "text"]),
    },
    ToolDef {
        name: "tag_note",
        title: "Tag a note",
        level: Access::Write,
        destructive: false,
        idempotent: true,
        description: "Add a tag to a note.",
        schema: || object(json!({ "id": id_param(), "tag": tag_param() }), &["id", "tag"]),
    },
    ToolDef {
        name: "untag_note",
        title: "Untag a note",
        level: Access::Write,
        destructive: true,
        idempotent: true,
        description: "Remove a tag from a note. A #tag still written in the body comes back on the next edit.",
        schema: || object(json!({ "id": id_param(), "tag": tag_param() }), &["id", "tag"]),
    },
    ToolDef {
        name: "add_to_space",
        title: "Add a note to a Space",
        level: Access::Write,
        destructive: false,
        idempotent: true,
        description: "Add a note to a space, creating the space if it is new.",
        schema: || object(json!({ "id": id_param(), "space": space_param() }), &["id", "space"]),
    },
    ToolDef {
        name: "remove_from_space",
        title: "Take a note out of a Space",
        level: Access::Write,
        destructive: true,
        idempotent: true,
        description: "Take a note out of a space. The note itself is kept.",
        schema: || object(json!({ "id": id_param(), "space": space_param() }), &["id", "space"]),
    },
    ToolDef {
        name: "trash_note",
        title: "Move a note to the Trash",
        level: Access::Write,
        destructive: true,
        idempotent: true,
        description: "Move a note to the Trash. The user can restore it; nothing is deleted for good.",
        schema: || object(json!({ "id": id_param() }), &["id"]),
    },
    ToolDef {
        name: "restore_note",
        title: "Restore a note from the Trash",
        level: Access::Write,
        destructive: false,
        idempotent: true,
        description: "Bring a note back from the Trash.",
        schema: || object(json!({ "id": id_param() }), &["id"]),
    },
];

// Parameter schemas several tools share.
fn id_param() -> Value {
    json!({ "type": "string", "description": "A note id, as search_notes, list_notes, or get_note return it." })
}

fn tag_param() -> Value {
    json!({ "type": "string", "description": "Tag name, with or without #." })
}

fn space_param() -> Value {
    json!({ "type": "string", "description": "Space name; case does not matter." })
}

fn limit_param() -> Value {
    json!({ "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT })
}

/// An input schema as MCP wants it: an object that accepts exactly these
/// properties, since the server rejects any other.
fn object(properties: Value, required: &[&str]) -> Value {
    let mut schema =
        json!({ "type": "object", "properties": properties, "additionalProperties": false });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    schema
}

impl<'a> Tools<'a> {
    /// A connection begins: the session is on record from here, so the app
    /// can say an agent is connected before it has asked for anything.
    pub(crate) fn new(
        store: &'a mut Store,
        attachments_dir: Option<PathBuf>,
        session: String,
    ) -> Self {
        let _ = store.open_agent_session(&session, "agent");
        Tools {
            store,
            attachments_dir,
            client: "agent".into(),
            session,
            traced: None,
        }
    }

    /// The connection ended cleanly.
    pub(crate) fn disconnect(&mut self) {
        let _ = self.store.close_agent_session(&self.session);
    }

    pub(crate) fn store(&self) -> &Store {
        self.store
    }

    pub(crate) fn set_client(&mut self, name: &str) {
        if !name.trim().is_empty() {
            self.client = name.trim().to_string();
            let _ = self.store.name_agent_session(&self.session, &self.client);
        }
    }

    /// Every tool, in a fixed order so a client's cache and prompt stay
    /// stable. The title is given twice: top level for 2025-06-18 and later,
    /// in the annotations for 2025-03-26.
    pub(crate) fn list(&self) -> Vec<Value> {
        TOOLS
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "title": t.title,
                    "description": t.description,
                    "inputSchema": (t.schema)(),
                    "annotations": {
                        "title": t.title,
                        "readOnlyHint": t.level == Access::Read,
                        "destructiveHint": t.destructive,
                        "idempotentHint": t.idempotent,
                        // Only this library, never the wider world.
                        "openWorldHint": false,
                    },
                })
            })
            .collect()
    }

    pub(crate) fn knows(&self, name: &str) -> bool {
        TOOLS.iter().any(|t| t.name == name)
    }

    /// Run a tool that exists (see `knows`). Failures are tool results with
    /// `isError`, which the model sees and can act on. A success carries its
    /// JSON twice, as MCP asks: structured, and as text for older clients.
    pub(crate) fn call(&mut self, name: &str, args: Value) -> Value {
        self.traced = None;
        let outcome = match TOOLS.iter().find(|t| t.name == name) {
            None => Err(format!("unknown tool: {name}")),
            // A refused call leaves no trace: off means off.
            Some(def) => Access::check(self.store, def.level).and_then(|()| {
                let kind = match (def.level, def.name) {
                    (Access::Write, _) => Kind::Write,
                    (_, "search_notes") => Kind::Search,
                    _ => Kind::Read,
                };
                let mut trace = Trace::start(def.name, kind, Scope::of(&args));
                trace.snapshot(self.store);
                let outcome = self.dispatch(name, args);
                self.traced = trace.finish(self.store, &self.session, &self.client, &outcome);
                outcome
            }),
        };
        match outcome {
            Ok(value) => json!({
                "content": [{ "type": "text", "text": pretty(&value) }],
                "structuredContent": value,
                "isError": false,
            }),
            Err(message) => json!({
                "content": [{ "type": "text", "text": message }],
                "isError": true,
            }),
        }
    }

    /// Keep the raw exchange with the call just traced: the message as the
    /// agent sent it and the reply as it goes back. Best effort, like the
    /// trace itself. A refused call left no row, so it keeps nothing.
    pub(crate) fn record_wire(&mut self, request: &str, response: &str) {
        if let Some(seq) = self.traced.take() {
            let _ = self.store.set_activity_wire(seq, request, response);
        }
    }

    fn dispatch(&mut self, name: &str, args: Value) -> ToolResult {
        match name {
            "search_notes" => self.search_notes(parse(args)?),
            "list_notes" => self.list_notes(parse(args)?),
            "get_note" => {
                let a: IdArgs = parse(args)?;
                self.note_view(&a.id)
            }
            "list_tags" => {
                let tags = self.store.list_tags().map_err(fail)?;
                Ok(json!({ "tags": tags.iter().map(|t| json!({
                    "name": t.tag.name, "notes": t.usage_count
                })).collect::<Vec<_>>() }))
            }
            "list_spaces" => {
                let spaces = self.store.list_workspaces().map_err(fail)?;
                Ok(json!({ "spaces": spaces.iter().map(|w| json!({
                    "name": w.workspace.name, "notes": w.note_count
                })).collect::<Vec<_>>() }))
            }
            "create_note" => self.create_note(parse(args)?),
            "update_note" => self.update_note(parse(args)?),
            "append_to_note" => self.append_to_note(parse(args)?),
            "tag_note" => {
                let a: TagArgs = parse(args)?;
                self.store.add_tag_to_note(&a.id, &a.tag).map_err(fail)?;
                self.note_view(&a.id)
            }
            "untag_note" => {
                let a: TagArgs = parse(args)?;
                let tag_id = self.tag_id(&a.tag)?;
                self.store
                    .remove_tag_from_note(&a.id, &tag_id)
                    .map_err(fail)?;
                self.note_view(&a.id)
            }
            "add_to_space" => {
                let a: SpaceArgs = parse(args)?;
                self.store.get_note(&a.id, false).map_err(fail)?;
                let ws = self.store.get_or_create_workspace(&a.space).map_err(fail)?;
                self.store
                    .add_note_to_workspace(&a.id, &ws.id)
                    .map_err(fail)?;
                self.note_view(&a.id)
            }
            "remove_from_space" => {
                let a: SpaceArgs = parse(args)?;
                let space_id = self.space_id(&a.space)?;
                self.store
                    .remove_note_from_workspace(&a.id, &space_id)
                    .map_err(fail)?;
                self.note_view(&a.id)
            }
            "trash_note" => {
                let a: IdArgs = parse(args)?;
                self.store.soft_delete_note(&a.id).map_err(fail)?;
                self.note_view(&a.id)
            }
            "restore_note" => {
                let a: IdArgs = parse(args)?;
                self.store.restore_note(&a.id).map_err(fail)?;
                self.note_view(&a.id)
            }
            _ => Err(format!("unknown tool: {name}")),
        }
    }

    fn search_notes(&mut self, a: SearchArgs) -> ToolResult {
        let hits = self
            .store
            .search_notes(&a.query, clamp_limit(a.limit))
            .map_err(fail)?;
        // One query for every hit's Spaces, not one per hit.
        let ids: Vec<String> = hits.iter().map(|h| h.note_id.clone()).collect();
        let mut spaces = self.store.workspaces_for_notes(&ids).map_err(fail)?;
        let results: Vec<Value> = hits
            .iter()
            .map(|h| {
                json!({
                    "id": h.note_id,
                    "title": unmark(&h.title),
                    "spaces": spaces.remove(&h.note_id).unwrap_or_default(),
                    "excerpt": unmark(&h.excerpt),
                    "updatedAt": h.updated_at,
                })
            })
            .collect();
        Ok(json!({ "results": results }))
    }

    fn list_notes(&mut self, a: ListArgs) -> ToolResult {
        let mut filter = NoteFilter {
            limit: Some(clamp_limit(a.limit)),
            offset: a.offset.map(|o| o.max(0)),
            ..Default::default()
        };
        match a.status.as_deref().unwrap_or("active") {
            "active" => {}
            "pinned" => filter.is_pinned = Some(true),
            "archived" => filter.is_archived = Some(true),
            "trash" => filter.is_deleted = Some(true),
            // The app's Revisit view, same filter (library.svelte.ts).
            "revisit" => {
                let cutoff = chrono::Utc::now() - chrono::Duration::milliseconds(REVISIT_AFTER_MS);
                filter.never_opened = Some(true);
                // Same form as stored timestamps, which compare as strings.
                filter.created_before =
                    Some(cutoff.to_rfc3339_opts(chrono::SecondsFormat::Micros, true));
                filter.sort_by = Some("createdAt".into());
                filter.sort_order = Some("asc".into());
            }
            other => return Err(format!("unknown status: {other}")),
        }
        if let Some(space) = &a.space {
            filter.workspace_id = Some(self.space_id(space)?);
        }
        if let Some(tag) = &a.tag {
            filter.tag_ids = vec![self.tag_id(tag)?];
        }
        let notes = self.store.list_notes(filter).map_err(fail)?;
        Ok(json!({ "notes": notes.iter().map(summary).collect::<Vec<_>>() }))
    }

    fn create_note(&mut self, a: CreateArgs) -> ToolResult {
        let note = self
            .store
            .create_note(CreateNoteInput {
                title: a.title,
                body: Some(a.body),
                tags: a.tags,
            })
            .map_err(fail)?;
        if let Some(space) = &a.space {
            let ws = self.store.get_or_create_workspace(space).map_err(fail)?;
            self.store
                .add_note_to_workspace(&note.id, &ws.id)
                .map_err(fail)?;
        }
        self.note_view(&note.id)
    }

    fn update_note(&mut self, a: UpdateArgs) -> ToolResult {
        if a.title.is_none() && a.body.is_none() {
            return Err("give a title, a body, or both".into());
        }
        let current = self.store.get_note(&a.id, false).map_err(fail)?;
        if a.body.is_some() {
            refuse_whiteboard(&current)?;
        }
        let patch = UpdateNotePatch {
            title: a.title,
            body: a.body,
            expected_updated_at: Some(a.expected_updated_at),
            ..Default::default()
        };
        match self.store.update_note(&a.id, patch) {
            Ok(_) => {}
            // Hand back what is there now, so the retry needs no extra read.
            Err(AppError::Conflict(_)) => {
                let now = self.note_view(&a.id)?;
                return Err(format!(
                    "CONFLICT: the note changed since that updatedAt. Retry with the current note:\n{}",
                    pretty(&now)
                ));
            }
            Err(e) => return Err(fail(e)),
        }
        // The caller just sent the body; echoing it back only costs tokens.
        let mut view = self.note_view(&a.id)?;
        if let Value::Object(fields) = &mut view {
            fields.remove("body");
            fields.remove("attachmentsDir");
        }
        Ok(view)
    }

    fn append_to_note(&mut self, a: AppendArgs) -> ToolResult {
        for _ in 0..APPEND_ATTEMPTS {
            let current = self.store.get_note(&a.id, false).map_err(fail)?;
            refuse_whiteboard(&current)?;
            let body = appended(&current.body, &a.text);
            let patch = UpdateNotePatch {
                body: Some(body),
                expected_updated_at: Some(current.updated_at),
                ..Default::default()
            };
            match self.store.update_note(&a.id, patch) {
                Ok(_) => return self.note_view(&a.id),
                Err(AppError::Conflict(_)) => continue,
                Err(e) => return Err(fail(e)),
            }
        }
        Err("CONFLICT: the note kept changing while appending; try again".into())
    }

    /// Recent notes as MCP resources, for `resources/list`.
    pub(crate) fn resources(&self) -> Result<Vec<Value>, String> {
        let notes = self
            .store
            .list_notes(NoteFilter {
                limit: Some(RESOURCE_LIST),
                ..Default::default()
            })
            .map_err(fail)?;
        Ok(notes
            .iter()
            .map(|n| {
                json!({
                    "uri": format!("{NOTE_URI_PREFIX}{}", n.id),
                    "name": n.id,
                    "title": n.title,
                    "mimeType": "text/markdown",
                    "annotations": { "lastModified": n.updated_at },
                })
            })
            .collect())
    }

    /// One note as a resource's contents: its Markdown.
    pub(crate) fn resource(&mut self, uri: &str) -> Result<Value, String> {
        let id = uri
            .strip_prefix(NOTE_URI_PREFIX)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("unknown resource: {uri}"))?;
        let note = self.store.get_note(id, false).map_err(fail)?;
        Ok(json!({
            "uri": uri,
            "name": note.id,
            "title": note.title,
            "mimeType": "text/markdown",
            "text": note.body,
        }))
    }

    /// A note in full, as every read and write tool returns it.
    fn note_view(&mut self, id: &str) -> ToolResult {
        let note = self.store.get_note(id, false).map_err(fail)?;
        let tags = self.store.tags_for_note(id).map_err(fail)?;
        let spaces = self.store.workspaces_for_note(id).map_err(fail)?;
        let mut view = json!({
            "id": note.id,
            "title": note.title,
            "kind": note.content_kind,
            "body": note.body,
            "tags": tags.iter().map(|t| &t.name).collect::<Vec<_>>(),
            "spaces": spaces.iter().map(|w| &w.name).collect::<Vec<_>>(),
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "isPinned": note.is_pinned,
            "isArchived": note.is_archived,
            "isDeleted": note.is_deleted,
        });
        // Bodies reference images as `attachments/<file>`; this is where
        // those files are, for an agent that can read them.
        if let Some(dir) = &self.attachments_dir {
            view["attachmentsDir"] = json!(dir);
        }
        Ok(view)
    }

    fn tag_id(&self, raw: &str) -> Result<String, String> {
        let name = normalize_tag_name(raw).ok_or("tag name must not be empty")?;
        self.store
            .find_tag(&name)
            .map_err(fail)?
            .map(|t| t.id)
            .ok_or_else(|| format!("NOT_FOUND: no tag named {name}"))
    }

    fn space_id(&self, raw: &str) -> Result<String, String> {
        let name = normalize_workspace_name(raw).ok_or("space name must not be empty")?;
        self.store
            .find_workspace(&name)
            .map_err(fail)?
            .map(|w| w.id)
            .ok_or_else(|| format!("NOT_FOUND: no space named {name}"))
    }
}

fn summary(note: &Note) -> Value {
    let collapsed = note.body.split_whitespace().collect::<Vec<_>>().join(" ");
    let snippet: String = collapsed.chars().take(SNIPPET_CHARS).collect();
    json!({
        "id": note.id,
        "title": note.title,
        "kind": note.content_kind,
        "snippet": snippet,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "isPinned": note.is_pinned,
        "isArchived": note.is_archived,
        "isDeleted": note.is_deleted,
    })
}

/// A whiteboard's body is the text on its canvas, rewritten by every canvas
/// save, so writing it would be silently undone.
fn refuse_whiteboard(note: &Note) -> Result<(), String> {
    if note.content_kind == CONTENT_KIND_WHITEBOARD {
        return Err("this note is a whiteboard; its text can only be edited in the app".into());
    }
    Ok(())
}

fn appended(body: &str, text: &str) -> String {
    if body.is_empty() {
        text.to_string()
    } else if body.ends_with('\n') {
        format!("{body}{text}")
    } else {
        format!("{body}\n{text}")
    }
}

fn clamp_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// Search marks matches with \u{1} and \u{2} for the app to highlight.
fn unmark(s: &str) -> String {
    s.replace(['\u{1}', '\u{2}'], "")
}

/// A session id without a uuid dependency: the process id and the start
/// time, which no two concurrent servers on one machine share.
pub(crate) fn session_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("{:x}-{:x}", std::process::id(), now)
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

fn parse<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdArgs {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    query: String,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListArgs {
    space: Option<String>,
    tag: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateArgs {
    body: String,
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    space: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateArgs {
    id: String,
    expected_updated_at: String,
    title: Option<String>,
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppendArgs {
    id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TagArgs {
    id: String,
    tag: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpaceArgs {
    id: String,
    space: String,
}
