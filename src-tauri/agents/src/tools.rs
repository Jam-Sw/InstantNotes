//! The tools an agent can call, as `tools/list` describes them.
//!
//! Every tool maps onto a public `Store` method, so an agent's write goes
//! through the same rules as a keystroke in the app. The surface says
//! "space" (the product term); the core underneath says "workspace".
//!
//! Deliberately absent, at every access level: permanent delete, settings,
//! the vault, and whiteboard canvases. A sheet's grid is reached one way:
//! `append_sheet_rows` adds rows and nothing else, which is what keeps an
//! agent's write mergeable with the user's unsaved cells in the app.

use crate::access::Access;
use crate::activity::{Kind, Scope, Trace};
use crate::fail;
use instantnotes_core::clients::{identify, parent_process, Client, ClientProcess};
use instantnotes_core::domain::{normalize_tag_name, normalize_workspace_name};
use instantnotes_core::sheet::Sheet;
use instantnotes_core::store::now_ms;
use instantnotes_core::types::NoteSearch;
use instantnotes_core::types::{
    CreateNoteInput, Note, NoteFilter, UpdateNotePatch, CONTENT_KIND_SHEET, CONTENT_KIND_WHITEBOARD,
};
use instantnotes_core::{AppError, Store};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

const RESOURCE_LIST: i64 = 50;
pub(crate) const NOTE_URI_PREFIX: &str = "instantnotes://notes/";

const SNIPPET_CHARS: usize = 160;
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
const MAX_READ: usize = 50;
/// Passages shown per search result; the rest are counted.
const MAX_PASSAGES: usize = 3;
const PASSAGE_LINE_CHARS: usize = 240;
/// append_to_note re-reads and retries when the user saves in between.
const APPEND_ATTEMPTS: usize = 3;
// this search page size supported by https://www.anthropic.com/engineering/writing-tools-for-agents (pagination with sensible default values)
const SEARCH_LIMIT: i64 = 10;
// these body caps supported by https://www.anthropic.com/engineering/writing-tools-for-agents (truncation with sensible defaults; Claude Code caps tool output at 25,000 tokens)
const NOTE_CHARS: usize = 12_000;
const MAX_NOTE_CHARS: usize = 100_000;
const MIN_NOTE_CHARS: usize = 1_000;
const READ_BUDGET_CHARS: usize = 60_000;
const HEADER_CELL_CHARS: usize = 60;

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
    /// The client, as the process that started this server shows it.
    launched_by: Option<Client>,
    /// The trace row of the call just made, until the transport attaches the
    /// raw messages to it.
    traced: Option<i64>,
}

struct ToolDef {
    name: &'static str,
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
        description: "Full-text search over note titles and bodies: the way to find what matters without reading every note. Use two or three keywords, not a sentence. Each result carries id, title, spaces, tags, createdAt, and updatedAt (enough to call update_note directly), and with detail \"passages\" the matching lines with their line numbers and the lines around them. Narrow by space, tag, status, or when a note last changed. Results are paged: total says how many notes match in all, hasMore whether to ask again with nextOffset. Trashed notes are searched only with status \"trash\".",
        schema: || object(json!({
            "query": { "type": "string", "description": "Words to search for. A word also matches words that begin with it." },
            "match": {
                "type": "string",
                "enum": ["all", "any"],
                "default": "all",
                "description": "all: notes with every word. any: notes with at least one, for casting wide (deadline due owe renew)."
            },
            "detail": {
                "type": "string",
                "enum": ["titles", "passages"],
                "default": "passages",
                "description": "titles: id, title, spaces, and updatedAt only, to locate a note cheaply. passages: also the matching lines."
            },
            "space": space_param(),
            "tag": tag_param(),
            "status": {
                "type": "string",
                "enum": ["active", "archived", "pinned", "trash", "all"],
                "default": "active",
                "description": "active: notes not archived or trashed. archived, pinned, trash: those notes. all: active and archived together."
            },
            "updatedAfter": date_param("Only notes last changed on or after this."),
            "updatedBefore": date_param("Only notes last changed before this."),
            "limit": limit_param(SEARCH_LIMIT),
            "offset": offset_param()
        }), &["query"]),
    },
    ToolDef {
        name: "list_notes",
        title: "List notes",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "List notes, most recently updated first, optionally within a space or tag or a span of time. Returns summaries, not full bodies: read the ones that matter with get_notes. Paged: total says how many notes match in all, hasMore whether to ask again with nextOffset.",
        schema: || object(json!({
            "space": space_param(),
            "tag": tag_param(),
            "updatedAfter": date_param("Only notes last changed on or after this."),
            "updatedBefore": date_param("Only notes last changed before this."),
            "status": {
                "type": "string",
                "enum": ["active", "pinned", "archived", "trash", "revisit"],
                "default": "active",
                "description": "active: notes not archived or trashed. pinned, archived, trash: those notes. revisit: open loops, captures never opened in the app and older than three days, oldest first."
            },
            "limit": limit_param(DEFAULT_LIMIT),
            "offset": offset_param()
        }), &[]),
    },
    ToolDef {
        name: "get_note",
        title: "Read a note",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Read one note: body, tags, spaces, and updatedAt (pass it to update_note). A body longer than maxChars comes back cut, with truncated true, totalChars, and nextBodyOffset: pass that as bodyOffset to read on. A sheet also returns sheet: its column count, its rows holding data, and header, its first row. Reading does not mark the note as opened.",
        schema: || object(json!({
            "id": id_param(),
            "maxChars": max_chars_param(NOTE_CHARS),
            "bodyOffset": { "type": "integer", "minimum": 0, "default": 0, "description": "Characters of the body to skip, from nextBodyOffset of the previous read." }
        }), &["id"]),
    },
    ToolDef {
        name: "get_notes",
        title: "Read several notes",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Read several notes in one call, in the order asked: what get_note returns, for each id, with the bodies cut to share one budget (the more ids, the shorter each). A cut note says truncated true: read on with get_note and bodyOffset. Ids that name no note come back in missing rather than failing the call. Reading does not mark a note as opened.",
        schema: || object(json!({
            "ids": {
                "type": "array",
                "items": id_param(),
                "minItems": 1,
                "maxItems": MAX_READ,
                "description": "Note ids, as search_notes or list_notes return them."
            },
            "maxChars": max_chars_param(NOTE_CHARS)
        }), &["ids"]),
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
        description: "Every Space with how many notes it holds. Call this before create_note, so the note \
                      is filed in an existing Space instead of a new or missing one.",
        schema: || object(json!({}), &[]),
    },
    ToolDef {
        name: "suggest_space",
        title: "Where a note belongs",
        level: Access::Read,
        destructive: false,
        idempotent: true,
        description: "Suggests a Space for notes that are in none; files nothing (use add_to_space if a suggestion is right). One Space per note with a probability and up to three reasons, from the same model as the app's Graph. Pass an id for one note, or nothing for every unfiled note, newest first. A note is listed only when the evidence clearly favours a Space, so an empty answer means the library does not say; a note already in a Space is never listed. Paged like list_notes: total, hasMore, nextOffset.",
        schema: || object(json!({
            "id": id_param(),
            "limit": limit_param(DEFAULT_LIMIT),
            "offset": offset_param()
        }), &[]),
    },
    ToolDef {
        name: "create_note",
        title: "Create a note",
        level: Access::Write,
        destructive: false,
        idempotent: false,
        description: "Create a note. The title is taken from the first line unless given. #words in the body \
                      become tags. Always file it: pass `space` with the existing Space it belongs in \
                      (call list_spaces first). A note without a space is lost in All Notes. Returns the \
                      note without its body; createdSpace is true when `space` named a new Space.",
        schema: || object(json!({
            "body": { "type": "string", "description": "Markdown." },
            "title": { "type": "string", "description": "Only to override the first line as the title." },
            "tags": { "type": "array", "items": tag_param() },
            "space": { "type": "string", "description": "The existing Space this note belongs in (names from list_spaces). A new name creates a new Space, so reuse an existing one when it fits. Required whenever the library has any Space." }
        }), &["body"]),
    },
    ToolDef {
        name: "update_note",
        title: "Rewrite a note",
        level: Access::Write,
        destructive: true,
        idempotent: true,
        description: "Replace a note's title and/or whole body; to change part of a body use edit_note. expectedUpdatedAt is the updatedAt from search_notes, list_notes, or get_note; no need to read the note first. A CONFLICT means the user changed it since, and carries the current note (its body cut at 12,000 characters) to retry from. Documents only: a sheet or whiteboard body is refused. Returns the note without its body.",
        schema: || object(json!({
            "id": id_param(),
            "expectedUpdatedAt": { "type": "string", "description": "The note's updatedAt, exactly as search_notes, list_notes, or get_note returned it." },
            "title": { "type": "string", "description": "New title. Omit to keep it." },
            "body": { "type": "string", "description": "Markdown; replaces the whole body. Omit to keep it." }
        }), &["id", "expectedUpdatedAt"]),
    },
    ToolDef {
        name: "edit_note",
        title: "Edit part of a note",
        level: Access::Write,
        destructive: true,
        idempotent: false,
        description: "Replace one exact passage of a note's body. oldText must appear exactly once: copy it from a search passage or get_note, with enough surrounding text to be unique; otherwise the call fails and says how many matches it found. Prefer this to update_note for any change smaller than the whole note. Documents only: a sheet or whiteboard body is refused. Returns the note without its body.",
        schema: || object(json!({
            "id": id_param(),
            "oldText": { "type": "string", "minLength": 1, "description": "The exact text to replace, appearing once in the body." },
            "newText": { "type": "string", "description": "What replaces it. An empty string deletes oldText." }
        }), &["id", "oldText", "newText"]),
    },
    ToolDef {
        name: "append_to_note",
        title: "Add to a note",
        level: Access::Write,
        destructive: false,
        idempotent: false,
        description: "Add text to the end of a note on a new line, without replacing what is there. Documents only: for a sheet use append_sheet_rows; a whiteboard is refused. Returns the note without its body.",
        schema: || object(json!({
            "id": id_param(),
            "text": { "type": "string", "description": "Markdown." }
        }), &["id", "text"]),
    },
    ToolDef {
        name: "append_sheet_rows",
        title: "Add rows to a sheet",
        level: Access::Write,
        destructive: false,
        idempotent: false,
        description: "Add rows to the bottom of a sheet note (kind \"sheet\"), after its last row holding data. Each row is a list of cell strings in column order; a short row is padded, a row wider than the sheet is refused. get_note's `sheet` says how many columns it has.",
        schema: || object(json!({
            "id": id_param(),
            "rows": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "array", "items": { "type": "string" } },
                "description": "Rows to add, each a list of cells left to right."
            }
        }), &["id", "rows"]),
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
        description: "Add an existing note to a Space. Use it to file a note that has no Space, or one \
                      suggest_space matched. A name that matches no Space creates one (createdSpace true \
                      in the result), so call list_spaces first and reuse an existing name.",
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

fn id_param() -> Value {
    json!({ "type": "string", "description": "A note id, as search_notes, list_notes, or get_note return it." })
}

fn tag_param() -> Value {
    json!({ "type": "string", "description": "Tag name, with or without #." })
}

fn space_param() -> Value {
    json!({ "type": "string", "description": "Space name; case does not matter." })
}

fn date_param(description: &str) -> Value {
    json!({
        "type": "string",
        "description": format!("{description} A date (2026-09-01) or a UTC timestamp (2026-09-01T08:00:00Z).")
    })
}

fn limit_param(default: i64) -> Value {
    json!({ "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": default, "description": "Results per page; the result echoes the limit applied." })
}

fn offset_param() -> Value {
    json!({ "type": "integer", "minimum": 0, "default": 0, "description": "Results to skip: nextOffset from the previous page." })
}

fn max_chars_param(default: usize) -> Value {
    json!({ "type": "integer", "minimum": MIN_NOTE_CHARS, "maximum": MAX_NOTE_CHARS, "default": default, "description": "Body characters returned per note; a longer body is cut and says so." })
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
        // Who started this server says which client it is, even one whose
        // handshake will name nothing (Hermes sends `mcp`), and which of
        // that client's sessions this is.
        let (process, launched_by) = launcher();
        let client = launched_by.map_or("agent", Client::as_str).to_string();
        let _ = store.open_agent_session(&session, &client);
        let _ =
            store.describe_agent_session(&session, &identify(launched_by, process.as_ref(), &env));
        Tools {
            store,
            attachments_dir,
            client,
            launched_by,
            session,
            traced: None,
        }
    }

    pub(crate) fn disconnect(&mut self) {
        let _ = self.store.close_agent_session(&self.session);
    }

    pub(crate) fn store(&self) -> &Store {
        self.store
    }

    pub(crate) fn set_client(&mut self, name: &str) {
        let name = name.trim();
        // A handshake that names no client in particular (`mcp` is the MCP
        // SDK's own default) does not replace what the launcher showed.
        let generic = matches!(name, "mcp" | "agent");
        let keep_launcher = generic && self.launched_by.is_some();
        if !name.is_empty() && !keep_launcher {
            self.client = name.to_string();
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
            None => Err(format!("Unknown tool: {name}")),
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
                "content": [{ "type": "text", "text": compact(&value) }],
                "structuredContent": value,
                "isError": false,
            }),
            Err(message) => json!({
                "content": [{ "type": "text", "text": message }],
                "isError": true,
            }),
        }
    }

    /// Keep the raw exchange with the call just traced. A refused call left
    /// no row, so it keeps nothing.
    pub(crate) fn record_wire(&mut self, request: &str, response: &str) {
        if let Some(seq) = self.traced.take() {
            let _ = self.store.set_activity_wire(seq, request, response);
        }
    }

    fn dispatch(&mut self, name: &str, args: Value) -> ToolResult {
        match name {
            "search_notes" => self.search_notes(parse(args)?),
            "list_notes" => self.list_notes(parse(args)?),
            "get_note" => self.get_note(parse(args)?),
            "get_notes" => self.get_notes(parse(args)?),
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
            "suggest_space" => self.suggest_space(parse(args)?),
            "create_note" => self.create_note(parse(args)?),
            "update_note" => self.update_note(parse(args)?),
            "edit_note" => self.edit_note(parse(args)?),
            "append_to_note" => self.append_to_note(parse(args)?),
            "append_sheet_rows" => self.append_sheet_rows(parse(args)?),
            "tag_note" => {
                let a: TagArgs = parse(args)?;
                self.store.add_tag_to_note(&a.id, &a.tag).map_err(fail)?;
                self.note_view(&a.id, None)
            }
            "untag_note" => {
                let a: TagArgs = parse(args)?;
                let tag_id = self.tag_id(&a.tag)?;
                self.store
                    .remove_tag_from_note(&a.id, &tag_id)
                    .map_err(fail)?;
                self.note_view(&a.id, None)
            }
            "add_to_space" => self.add_to_space(parse(args)?),
            "remove_from_space" => {
                let a: SpaceArgs = parse(args)?;
                let space_id = self.space_id(&a.space)?;
                self.store
                    .remove_note_from_workspace(&a.id, &space_id)
                    .map_err(fail)?;
                self.note_view(&a.id, None)
            }
            "trash_note" => {
                let a: IdArgs = parse(args)?;
                self.store.soft_delete_note(&a.id).map_err(fail)?;
                self.note_view(&a.id, None)
            }
            "restore_note" => {
                let a: IdArgs = parse(args)?;
                self.store.restore_note(&a.id).map_err(fail)?;
                self.note_view(&a.id, None)
            }
            _ => Err(format!("Unknown tool: {name}")),
        }
    }

    fn search_notes(&mut self, a: SearchArgs) -> ToolResult {
        let terms = search_terms(&a.query);
        if terms.is_empty() {
            return Err(
                "query needs at least one word; to browse without words use list_notes".into(),
            );
        }
        let titles_only = match a.detail.as_deref().unwrap_or("passages") {
            "passages" => false,
            "titles" => true,
            other => {
                return Err(format!(
                    "detail must be \"titles\" or \"passages\" (got {other})"
                ))
            }
        };
        let status = a.status.as_deref().unwrap_or("active");
        if !matches!(status, "active" | "archived" | "pinned" | "trash" | "all") {
            return Err(format!(
                "status must be active, archived, pinned, trash or all (got {status})"
            ));
        }
        let limit = clamp_limit(a.limit, SEARCH_LIMIT);
        let offset = a.offset.unwrap_or(0).max(0);
        let search = NoteSearch {
            text: a.query.clone(),
            any_term: match a.r#match.as_deref().unwrap_or("all") {
                "all" => false,
                "any" => true,
                other => return Err(format!("match must be \"all\" or \"any\" (got {other})")),
            },
            workspace_id: a.space.as_deref().map(|s| self.space_id(s)).transpose()?,
            tag_id: a.tag.as_deref().map(|t| self.tag_id(t)).transpose()?,
            is_archived: match status {
                "active" | "pinned" => Some(false),
                "archived" => Some(true),
                _ => None,
            },
            pinned_only: status == "pinned",
            trashed: status == "trash",
            updated_after: a.updated_after.as_deref().map(date_bound).transpose()?,
            updated_before: a.updated_before.as_deref().map(date_bound).transpose()?,
            limit,
            offset,
        };
        let page = self.store.search_notes_page(&search).map_err(fail)?;
        // One query for every hit's Spaces, not one per hit.
        let ids: Vec<String> = page.matches.iter().map(|h| h.note_id.clone()).collect();
        let mut spaces = self.store.workspaces_for_notes(&ids).map_err(fail)?;
        let mut results = Vec::with_capacity(page.matches.len());
        for hit in &page.matches {
            let hit_spaces = spaces.remove(&hit.note_id).unwrap_or_default();
            if titles_only {
                results.push(json!({
                    "id": hit.note_id,
                    "title": hit.title,
                    "spaces": hit_spaces,
                    "updatedAt": hit.updated_at,
                }));
                continue;
            }
            let tags = self.store.tags_for_note(&hit.note_id).map_err(fail)?;
            let (mut found, matching_lines) = passages(&hit.body, &terms);
            // Stemming can match a word the text never spells the way it was
            // asked (run, running): the index's own excerpt still shows why.
            if found.is_empty() {
                found.push(json!({ "text": unmark(&hit.excerpt) }));
            }
            results.push(json!({
                "id": hit.note_id,
                "title": hit.title,
                "spaces": hit_spaces,
                "tags": tags.iter().map(|t| &t.name).collect::<Vec<_>>(),
                "passages": found,
                "matchingLines": matching_lines,
                "createdAt": hit.created_at,
                "updatedAt": hit.updated_at,
                "isArchived": hit.is_archived,
            }));
        }
        let mut out = paged(
            json!({ "results": results }),
            "results",
            page.total,
            offset,
            limit,
        );
        if page.total == 0 {
            out["hint"] = json!(self.empty_search_hint(&search, terms.len())?);
        }
        Ok(out)
    }

    fn empty_search_hint(&mut self, search: &NoteSearch, words: usize) -> Result<String, String> {
        if !search.any_term && words > 1 {
            let wide = NoteSearch {
                any_term: true,
                limit: 1,
                offset: 0,
                ..search.clone()
            };
            let any = self.store.search_notes_page(&wide).map_err(fail)?.total;
            if any > 0 {
                return Ok(format!(
                    "No note contains all {words} words; {any} contain at least one. Retry with match \"any\", or with fewer, more specific words."
                ));
            }
        }
        Ok("No note matches. Try one shorter or different word, or drop the space, tag, status and date filters; list_notes browses without words.".into())
    }

    fn get_note(&mut self, a: GetArgs) -> ToolResult {
        let max = clamp_chars(a.max_chars);
        let offset = a.body_offset.unwrap_or(0).max(0) as usize;
        let mut view = self.note_view(&a.id, Some((offset, max)))?;
        if let Some(dir) = &self.attachments_dir {
            view["attachmentsDir"] = json!(dir);
        }
        Ok(view)
    }

    fn get_notes(&mut self, a: IdsArgs) -> ToolResult {
        if a.ids.is_empty() {
            return Err("give at least one id".into());
        }
        if a.ids.len() > MAX_READ {
            return Err(format!(
                "at most {MAX_READ} notes per call; ask again for the rest"
            ));
        }
        let each =
            clamp_chars(a.max_chars).min((READ_BUDGET_CHARS / a.ids.len()).max(MIN_NOTE_CHARS));
        let mut notes = Vec::with_capacity(a.ids.len());
        let mut missing = Vec::new();
        for id in &a.ids {
            match self.store.get_note(id, false) {
                Ok(_) => notes.push(self.note_view(id, Some((0, each)))?),
                Err(AppError::NotFound(_)) => missing.push(id.clone()),
                Err(e) => return Err(fail(e)),
            }
        }
        let mut out = json!({ "notes": notes, "missing": missing });
        if let Some(dir) = &self.attachments_dir {
            out["attachmentsDir"] = json!(dir);
        }
        Ok(out)
    }

    fn list_notes(&mut self, a: ListArgs) -> ToolResult {
        let limit = clamp_limit(a.limit, DEFAULT_LIMIT);
        let mut filter = NoteFilter {
            limit: Some(limit),
            offset: a.offset.map(|o| o.max(0)),
            ..Default::default()
        };
        match a.status.as_deref().unwrap_or("active") {
            "active" => {}
            "pinned" => filter.is_pinned = Some(true),
            "archived" => filter.is_archived = Some(true),
            "trash" => filter.is_deleted = Some(true),
            // The app's Revisit view: one rule, expanded by the store.
            "revisit" => filter.revisit = true,
            other => {
                return Err(format!(
                    "status must be active, pinned, archived, trash or revisit (got {other})"
                ))
            }
        }
        if let Some(space) = &a.space {
            filter.workspace_id = Some(self.space_id(space)?);
        }
        if let Some(tag) = &a.tag {
            filter.tag_ids = vec![self.tag_id(tag)?];
        }
        filter.updated_after = a.updated_after.as_deref().map(date_bound).transpose()?;
        filter.updated_before = a.updated_before.as_deref().map(date_bound).transpose()?;
        let offset = filter.offset.unwrap_or(0);
        let total = self.store.count_notes(&filter).map_err(fail)?;
        let notes = self.store.list_notes(filter).map_err(fail)?;
        Ok(paged(
            json!({ "notes": notes.iter().map(summary).collect::<Vec<_>>() }),
            "notes",
            total,
            offset,
            limit,
        ))
    }

    fn suggest_space(&mut self, a: SuggestArgs) -> ToolResult {
        let limit = clamp_limit(a.limit, DEFAULT_LIMIT);
        let offset = a.offset.unwrap_or(0).max(0);
        let all = self.store.space_suggestions().map_err(fail)?;
        let matching: Vec<_> = all
            .iter()
            .filter(|s| a.id.as_ref().is_none_or(|id| &s.note_id == id))
            .collect();
        let total = matching.len() as i64;
        let picked: Vec<Value> = matching
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(|s| {
                json!({
                    "id": s.note_id,
                    "title": s.note_title,
                    "space": s.space_name,
                    "probability": (s.probability * 100.0).round() / 100.0,
                    "reasons": s.reasons.iter().map(|r| r.label.clone()).collect::<Vec<_>>(),
                })
            })
            .collect();
        let mut out = paged(
            json!({ "suggestions": picked }),
            "suggestions",
            total,
            offset,
            limit,
        );
        if total == 0 && a.id.is_some() {
            out["hint"] =
                json!("No Space is clearly favoured for this note, or it is already filed.");
        }
        Ok(out)
    }

    fn file_note(&mut self, id: &str, space: &str) -> Result<bool, String> {
        let existed = match normalize_workspace_name(space) {
            Some(name) => self.store.find_workspace(&name).map_err(fail)?.is_some(),
            None => true,
        };
        let ws = self.store.get_or_create_workspace(space).map_err(fail)?;
        self.store.add_note_to_workspace(id, &ws.id).map_err(fail)?;
        Ok(!existed)
    }

    fn add_to_space(&mut self, a: SpaceArgs) -> ToolResult {
        self.store.get_note(&a.id, false).map_err(fail)?;
        let created = self.file_note(&a.id, &a.space)?;
        let mut view = self.note_view(&a.id, None)?;
        if created {
            view["createdSpace"] = json!(true);
        }
        Ok(view)
    }

    fn create_note(&mut self, a: CreateArgs) -> ToolResult {
        // A note with no Space is lost in All Notes, and agents rarely file one afterwards.
        // Refuse, naming the Spaces that exist, so the retry is one call. A library with no
        // Spaces yet has nothing to file into, so it is let through.
        if a.space.as_deref().is_none_or(|s| s.trim().is_empty()) {
            let names: Vec<String> = self
                .store
                .list_workspaces()
                .map_err(fail)?
                .into_iter()
                .map(|w| w.workspace.name)
                .collect();
            if !names.is_empty() {
                return Err(format!(
                    "Nothing was saved: pick a Space first. Existing Spaces: {}. Call create_note \
                     again with `space` set to the best match.",
                    names.join(", ")
                ));
            }
        }
        let note = self
            .store
            .create_note(CreateNoteInput {
                title: a.title,
                body: Some(a.body),
                tags: a.tags,
            })
            .map_err(fail)?;
        let created = match &a.space {
            Some(space) => self.file_note(&note.id, space)?,
            None => false,
        };
        let mut view = self.note_view(&note.id, None)?;
        if created {
            view["createdSpace"] = json!(true);
        }
        Ok(view)
    }

    fn update_note(&mut self, a: UpdateArgs) -> ToolResult {
        if a.title.is_none() && a.body.is_none() {
            return Err("give a title, a body, or both".into());
        }
        let current = self.store.get_note(&a.id, false).map_err(fail)?;
        if a.body.is_some() {
            refuse_derived_body(&current)?;
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
                let now = self.note_view(&a.id, Some((0, NOTE_CHARS)))?;
                return Err(format!(
                    "CONFLICT: the note changed since that updatedAt. Its current state follows: retry update_note with this updatedAt, or use edit_note to change one passage:\n{}",
                    compact(&now)
                ));
            }
            Err(e) => return Err(fail(e)),
        }
        self.note_view(&a.id, None)
    }

    fn edit_note(&mut self, a: EditArgs) -> ToolResult {
        if a.old_text.is_empty() {
            return Err("oldText must not be empty; to add text use append_to_note".into());
        }
        for _ in 0..APPEND_ATTEMPTS {
            let current = self.store.get_note(&a.id, false).map_err(fail)?;
            refuse_derived_body(&current)?;
            match current.body.matches(a.old_text.as_str()).count() {
                0 => {
                    return Err(
                        "NOT_FOUND: oldText does not appear in this note; get_note shows its current text"
                            .into(),
                    )
                }
                1 => {}
                n => {
                    return Err(format!(
                        "oldText appears {n} times; add surrounding text so it appears exactly once"
                    ))
                }
            }
            let patch = UpdateNotePatch {
                body: Some(current.body.replacen(&a.old_text, &a.new_text, 1)),
                expected_updated_at: Some(current.updated_at),
                ..Default::default()
            };
            match self.store.update_note(&a.id, patch) {
                Ok(_) => return self.note_view(&a.id, None),
                Err(AppError::Conflict(_)) => continue,
                Err(e) => return Err(fail(e)),
            }
        }
        Err("CONFLICT: the note kept changing while editing; try again".into())
    }

    fn append_to_note(&mut self, a: AppendArgs) -> ToolResult {
        for _ in 0..APPEND_ATTEMPTS {
            let current = self.store.get_note(&a.id, false).map_err(fail)?;
            refuse_derived_body(&current)?;
            let body = appended(&current.body, &a.text);
            let patch = UpdateNotePatch {
                body: Some(body),
                expected_updated_at: Some(current.updated_at),
                ..Default::default()
            };
            match self.store.update_note(&a.id, patch) {
                Ok(_) => return self.note_view(&a.id, None),
                Err(AppError::Conflict(_)) => continue,
                Err(e) => return Err(fail(e)),
            }
        }
        Err("CONFLICT: the note kept changing while appending; try again".into())
    }

    /// Rows go after the sheet's last row holding data; the store derives
    /// the Markdown body from the grid, as it does for the app's own saves.
    /// Read, append, write with the version check, and retry when the user
    /// saved in between, like `append_to_note`.
    fn append_sheet_rows(&mut self, a: SheetRowsArgs) -> ToolResult {
        for _ in 0..APPEND_ATTEMPTS {
            let current = self.store.get_note(&a.id, false).map_err(fail)?;
            if current.content_kind != CONTENT_KIND_SHEET {
                return Err(format!(
                    "this note is a {}, not a sheet; append_to_note adds text to it",
                    current.content_kind
                ));
            }
            let mut sheet = Sheet::parse(current.surface_data.as_deref().unwrap_or_default())
                .map_err(|e| format!("this sheet's grid cannot be read: {e}"))?;
            let first = sheet.append_rows(a.rows.clone())?;
            let patch = UpdateNotePatch {
                surface_data: Some(sheet.serialize()),
                expected_updated_at: Some(current.updated_at),
                ..Default::default()
            };
            match self.store.update_note(&a.id, patch) {
                Ok(_) => {
                    let mut view = self.note_view(&a.id, None)?;
                    // Spreadsheet numbering, as the app shows it.
                    view["appended"] = json!({ "firstRow": first + 1, "count": a.rows.len() });
                    return Ok(view);
                }
                Err(AppError::Conflict(_)) => continue,
                Err(e) => return Err(fail(e)),
            }
        }
        Err("CONFLICT: the sheet kept changing while appending; try again".into())
    }

    pub(crate) fn resources(&mut self) -> Result<Vec<Value>, String> {
        self.traced = None;
        let trace = Trace::start("resources/list", Kind::Read, Scope::of(&Value::Null));
        let outcome = self.list_resources();
        let seen = outcome.as_ref().map_or_else(
            |e| Err(e.clone()),
            |list| {
                Ok(json!({ "notes": list.iter().map(|r| json!({ "id": r["name"], "title": r["title"] })).collect::<Vec<_>>() }))
            },
        );
        self.traced = trace.finish(self.store, &self.session, &self.client, &seen);
        outcome
    }

    fn list_resources(&self) -> Result<Vec<Value>, String> {
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

    pub(crate) fn resource(&mut self, uri: &str) -> Result<Value, String> {
        self.traced = None;
        let id = uri
            .strip_prefix(NOTE_URI_PREFIX)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("unknown resource: {uri}"))?;
        let trace = Trace::start(
            "resources/read",
            Kind::Read,
            Scope::of(&json!({ "id": id })),
        );
        let outcome = self.read_resource(uri, id);
        let seen = outcome
            .as_ref()
            .map(|r| json!({ "id": r["name"], "title": r["title"] }))
            .map_err(Clone::clone);
        self.traced = trace.finish(self.store, &self.session, &self.client, &seen);
        outcome
    }

    fn read_resource(&mut self, uri: &str, id: &str) -> Result<Value, String> {
        let note = self.store.get_note(id, false).map_err(fail)?;
        Ok(json!({
            "uri": uri,
            "name": note.id,
            "title": note.title,
            "mimeType": "text/markdown",
            "text": note.body,
        }))
    }

    fn note_view(&mut self, id: &str, body: Option<(usize, usize)>) -> ToolResult {
        let note = self.store.get_note(id, false).map_err(fail)?;
        let tags = self.store.tags_for_note(id).map_err(fail)?;
        let spaces = self.store.workspaces_for_note(id).map_err(fail)?;
        let mut view = json!({
            "id": note.id,
            "title": note.title,
            "kind": note.content_kind,
            "tags": tags.iter().map(|t| &t.name).collect::<Vec<_>>(),
            "spaces": spaces.iter().map(|w| &w.name).collect::<Vec<_>>(),
            "createdAt": note.created_at,
            "updatedAt": note.updated_at,
            "isPinned": note.is_pinned,
            "isArchived": note.is_archived,
            "isDeleted": note.is_deleted,
        });
        if let Some((offset, max)) = body {
            let total = note.body.chars().count();
            let shown: String = note.body.chars().skip(offset).take(max).collect();
            let end = offset + shown.chars().count();
            view["body"] = json!(shown);
            if offset > 0 || end < total {
                view["truncated"] = json!(true);
                view["totalChars"] = json!(total);
            }
            if end < total {
                view["nextBodyOffset"] = json!(end);
            }
        }
        // A sheet's shape and header, so an agent knows the columns before it appends.
        if note.content_kind == CONTENT_KIND_SHEET {
            if let Ok(sheet) = Sheet::parse(note.surface_data.as_deref().unwrap_or_default()) {
                let mut shape = json!({ "cols": sheet.cols.len(), "rows": sheet.filled_rows() });
                if sheet.filled_rows() > 0 {
                    shape["header"] = json!(sheet.rows[0]
                        .iter()
                        .map(|c| c.chars().take(HEADER_CELL_CHARS).collect::<String>())
                        .collect::<Vec<_>>());
                }
                view["sheet"] = shape;
            }
        }
        Ok(view)
    }

    fn tag_id(&self, raw: &str) -> Result<String, String> {
        let name = normalize_tag_name(raw).ok_or("tag name must not be empty")?;
        self.store
            .find_tag(&name)
            .map_err(fail)?
            .map(|t| t.id)
            .ok_or_else(|| {
                format!("NOT_FOUND: no tag named {name}; list_tags shows the existing tags")
            })
    }

    fn space_id(&self, raw: &str) -> Result<String, String> {
        let name = normalize_workspace_name(raw).ok_or("space name must not be empty")?;
        self.store
            .find_workspace(&name)
            .map_err(fail)?
            .map(|w| w.id)
            .ok_or_else(|| {
                format!("NOT_FOUND: no space named {name}; list_spaces shows the existing spaces")
            })
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

/// A whiteboard's body is the text on its canvas and a sheet's is its grid
/// as a table, each rewritten by every save of the surface, so writing the
/// body would be silently undone.
fn refuse_derived_body(note: &Note) -> Result<(), String> {
    match note.content_kind.as_str() {
        CONTENT_KIND_WHITEBOARD => {
            Err("this note is a whiteboard; its text can only be edited in the app".into())
        }
        CONTENT_KIND_SHEET => Err(
            "this note is a sheet; its body is its grid. Use append_sheet_rows to add rows; cells are edited in the app"
                .into(),
        ),
        _ => Ok(()),
    }
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

fn clamp_limit(limit: Option<i64>, default: i64) -> i64 {
    limit.unwrap_or(default).clamp(1, MAX_LIMIT)
}

fn clamp_chars(max_chars: Option<i64>) -> usize {
    max_chars
        .unwrap_or(NOTE_CHARS as i64)
        .clamp(MIN_NOTE_CHARS as i64, MAX_NOTE_CHARS as i64) as usize
}

/// A page of results with where it stands, and where to ask for more.
fn paged(mut page: Value, key: &str, total: i64, offset: i64, limit: i64) -> Value {
    let shown = page[key].as_array().map_or(0, Vec::len) as i64;
    let has_more = offset + shown < total;
    page["total"] = json!(total);
    page["offset"] = json!(offset);
    page["limit"] = json!(limit);
    page["hasMore"] = json!(has_more);
    if has_more {
        page["nextOffset"] = json!(offset + shown);
    }
    page
}

/// A date or timestamp an agent gave, as a bound comparable as text with the
/// store's UTC ISO-8601 timestamps.
fn date_bound(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let is_date = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").is_ok();
    if is_date {
        return Ok(raw.to_string());
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|t| {
            t.with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
        })
        .map_err(|_| format!("not a date: {raw}; use 2026-09-01 or 2026-09-01T08:00:00Z"))
}

/// The words of a query, as the search index splits them, lowercased.
fn search_terms(query: &str) -> Vec<String> {
    query
        .split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_'))
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Up to `MAX_PASSAGES` non-overlapping passages (the matching line and one
/// either side) and how many lines match in all.
fn passages(body: &str, terms: &[String]) -> (Vec<Value>, usize) {
    let lines: Vec<&str> = body.lines().collect();
    let hits = |line: &str| {
        let lower = line.to_lowercase();
        terms.iter().any(|t| lower.contains(t.as_str()))
    };
    let mut found = Vec::new();
    let mut matching = 0;
    let mut covered = 0; // lines before this index are already in a passage
    for (i, line) in lines.iter().enumerate() {
        if !hits(line) {
            continue;
        }
        matching += 1;
        if i < covered || found.len() == MAX_PASSAGES {
            continue;
        }
        let from = i.saturating_sub(1).max(covered);
        let to = (i + 1).min(lines.len() - 1);
        let text = lines[from..=to]
            .iter()
            .map(|l| clip(l, terms))
            .collect::<Vec<_>>()
            .join("\n");
        found.push(json!({ "line": i + 1, "text": text.trim() }));
        covered = to + 1;
    }
    (found, matching)
}

fn clip(line: &str, terms: &[String]) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= PASSAGE_LINE_CHARS {
        return line.to_string();
    }
    let lower = line.to_lowercase();
    let at = terms
        .iter()
        .filter_map(|t| lower.find(t.as_str()))
        .min()
        .map_or(0, |byte| lower[..byte].chars().count());
    let start = at.saturating_sub(PASSAGE_LINE_CHARS / 3);
    let end = (start + PASSAGE_LINE_CHARS).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

/// Search marks matches with \u{1} and \u{2} for the app to highlight.
fn unmark(s: &str) -> String {
    s.replace(['\u{1}', '\u{2}'], "")
}

fn launcher() -> (Option<ClientProcess>, Option<Client>) {
    let process = parent_process();
    let client = process
        .as_ref()
        .and_then(|p| Client::from_command(&p.command))
        // Claude Code is not always called `claude`, but it always says so.
        .or_else(|| env("CLAUDE_CODE_SESSION_ID").map(|_| Client::ClaudeCode));
    (process, client)
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// A session id without a uuid dependency: the process id and the start
/// time, which no two concurrent servers on one machine share.
pub(crate) fn session_id() -> String {
    format!("{:x}-{:x}", std::process::id(), now_ms())
}

fn compact(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn parse<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SuggestArgs {
    id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdArgs {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct SearchArgs {
    query: String,
    r#match: Option<String>,
    detail: Option<String>,
    space: Option<String>,
    tag: Option<String>,
    status: Option<String>,
    updated_after: Option<String>,
    updated_before: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetArgs {
    id: String,
    max_chars: Option<i64>,
    body_offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdsArgs {
    ids: Vec<String>,
    max_chars: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditArgs {
    id: String,
    old_text: String,
    new_text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct ListArgs {
    space: Option<String>,
    tag: Option<String>,
    status: Option<String>,
    updated_after: Option<String>,
    updated_before: Option<String>,
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
struct SheetRowsArgs {
    id: String,
    rows: Vec<Vec<String>>,
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
