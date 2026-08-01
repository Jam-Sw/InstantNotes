use serde::{Deserialize, Serialize};

/// How a note is edited: markdown document or whiteboard surface.
/// Stored as a string on the wire (`"document"` | `"whiteboard"`).
pub const CONTENT_KIND_DOCUMENT: &str = "document";
pub const CONTENT_KIND_WHITEBOARD: &str = "whiteboard";

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
    /// `"document"` (markdown editor) or `"whiteboard"` (canvas host).
    pub content_kind: String,
    /// Engine-specific JSON for whiteboard notes; null for plain documents.
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateNotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    /// `"document"` or `"whiteboard"`. Invalid values are rejected.
    pub content_kind: Option<String>,
    /// Engine JSON for whiteboard notes. Omitted = leave alone; Some sets the
    /// value (including empty string). Product convert is one-way (document →
    /// whiteboard); this field still persists so the board survives reloads.
    pub surface_data: Option<String>,
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
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
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
