use serde::{Deserialize, Serialize};

/// How a note is edited: a Markdown document, a whiteboard canvas whose
/// text is kept in `body` for search and tags, or a sheet whose grid is
/// kept in `body` as a Markdown table. Strings on the wire.
pub const CONTENT_KIND_DOCUMENT: &str = "document";
pub const CONTENT_KIND_WHITEBOARD: &str = "whiteboard";
pub const CONTENT_KIND_SHEET: &str = "sheet";

/// Whether notes of this kind keep a surface in `surface_data` beside
/// their body: a whiteboard's canvas, a sheet's grid.
pub fn has_surface(content_kind: &str) -> bool {
    content_kind != CONTENT_KIND_DOCUMENT
}

/// Canonical note shape used by persistence and the desktop IPC layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub is_deleted: bool,
    pub deleted_at: Option<String>,
    /// `"document"`, `"whiteboard"`, or `"sheet"`.
    pub content_kind: String,
    /// A whiteboard's canvas or a sheet's grid as JSON. Only `get_note`
    /// carries it: list rows leave it out, since a board can hold pasted
    /// images.
    pub surface_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Tag with usage count for the library sidebar.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagWithCount {
    #[serde(flatten)]
    pub tag: Tag,
    pub usage_count: i64,
}

/// Named collection of notes; a note may belong to many workspaces.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Workspace with live note count for the library sidebar.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWithCount {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub note_count: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateNoteInput {
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Vec<String>,
}

/// One note to bring in from another app (`Store::import_notes`).
#[derive(Debug, Clone)]
pub struct ImportItem {
    /// Its id in the app it came from. Each is imported once per library.
    pub source_id: String,
    pub body: String,
    pub created_at: std::time::SystemTime,
    pub updated_at: std::time::SystemTime,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: usize,
    /// Imported before, and their note still exists (the Trash counts).
    pub skipped: usize,
    /// The Space they were filed in, when one was named and any landed.
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateNotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    /// `"whiteboard"` or `"sheet"` in practice: converting is one-way, and
    /// only a document converts.
    pub content_kind: Option<String>,
    /// A whiteboard's canvas or a sheet's grid; rejected on a document. A
    /// sheet's body is derived from it, so a body sent with it is ignored.
    pub surface_data: Option<String>,
    /// Optimistic concurrency: when set, the update applies only if the
    /// note's `updated_at` still equals it, and fails with `Conflict` otherwise.
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteFilter {
    pub query: Option<String>,
    pub tag_ids: Vec<String>,
    pub workspace_id: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    pub is_deleted: Option<bool>,
    /// Only notes never opened in the library (capture-born, untriaged).
    /// Drives the Revisit view; opening a note releases it from the filter.
    pub never_opened: Option<bool>,
    /// Only notes created strictly before this ISO-8601 timestamp.
    pub created_before: Option<String>,
    /// The Revisit view: never-opened captures older than the revisit window,
    /// oldest first. Expanded by the store.
    pub revisit: bool,
    /// Only notes last changed at or after / strictly before this ISO-8601
    /// timestamp or bare date.
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Aggregate library counts for the Settings dashboard. Attachment counts are
/// added by the desktop layer (they live on the filesystem, not in the store).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    /// Notes not in the Trash (active plus archived).
    pub notes_total: i64,
    /// Notes not in the Trash and not archived.
    pub notes_active: i64,
    pub notes_pinned: i64,
    pub notes_archived: i64,
    pub notes_trashed: i64,
    pub tags: i64,
    pub spaces: i64,
}

/// Search result for library queries. Tag search goes through the note_tags
/// join, not FTS.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub excerpt: String,
    pub score: f64,
    pub updated_at: String,
}

/// A paged, filtered full-text search (`Store::search_notes_page`).
#[derive(Debug, Clone, Default)]
pub struct NoteSearch {
    pub text: String,
    /// Match notes with any of the words, not all of them.
    pub any_term: bool,
    pub workspace_id: Option<String>,
    pub tag_id: Option<String>,
    /// `Some(false)`: live notes only. `Some(true)`: archived only. `None`:
    /// both.
    pub is_archived: Option<bool>,
    pub pinned_only: bool,
    pub trashed: bool,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

/// One note a paged search found, with its whole body.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteMatch {
    pub note_id: String,
    pub title: String,
    pub body: String,
    /// The matching excerpt, hits bracketed as in `SearchResult`.
    pub excerpt: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_archived: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NoteSearchPage {
    pub matches: Vec<NoteMatch>,
    /// How many notes match in all, whatever the limit and offset.
    pub total: i64,
}

/// What an attachment cleanup removed (or, for a preview, would remove).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentCleanup {
    pub count: usize,
    pub bytes: u64,
}

/// The library as a graph (SEQUENCE.md unit 13): live notes, the tags and
/// Spaces they carry, and one link per note-to-tag or note-to-Space edge.
/// Derived from the existing tables on every read; nothing is stored.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGraph {
    pub notes: Vec<GraphNote>,
    pub tags: Vec<GraphTag>,
    pub spaces: Vec<GraphSpace>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNote {
    pub id: String,
    pub title: String,
    pub content_kind: String,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSpace {
    pub id: String,
    pub name: String,
}

/// A note's membership: `kind` is `tag` or `space`, and `target_id` is that
/// tag's or Space's id. A tag link also says how it got there: `source` is
/// `inline` for a tag written in the text and `manual` for one added to the
/// note (DATA_MODEL.md section 4); a Space link has none.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    pub note_id: String,
    pub target_id: String,
    pub kind: String,
    pub source: Option<String>,
}

/// Where an unfiled note most likely belongs (API.md section 4): one Space,
/// how sure the model is, and the evidence that put it there.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSuggestion {
    pub note_id: String,
    pub note_title: String,
    pub space_id: String,
    pub space_name: String,
    /// The posterior probability of the Space, 0 to 1.
    pub probability: f64,
    /// The strongest evidence first, at most three.
    pub reasons: Vec<SuggestionReason>,
}

/// One piece of evidence behind a suggestion: a tag the note carries
/// (`kind` = `tag`, `label` with its `#`) or a word in its text (`word`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionReason {
    pub label: String,
    pub kind: String,
}
