use serde::{Deserialize, Serialize};

pub const CONTENT_KIND_DOCUMENT: &str = "document";
pub const CONTENT_KIND_WHITEBOARD: &str = "whiteboard";
pub const CONTENT_KIND_SHEET: &str = "sheet";

pub fn has_surface(content_kind: &str) -> bool {
    content_kind != CONTENT_KIND_DOCUMENT
}

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
    pub content_kind: String,
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagWithCount {
    #[serde(flatten)]
    pub tag: Tag,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

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

#[derive(Debug, Clone)]
pub struct ImportItem {
    pub source_id: String,
    pub body: String,
    pub created_at: std::time::SystemTime,
    pub updated_at: std::time::SystemTime,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: usize,
    pub skipped: usize,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateNotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub is_pinned: Option<bool>,
    pub is_archived: Option<bool>,
    pub content_kind: Option<String>,
    pub surface_data: Option<String>,
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
    pub never_opened: Option<bool>,
    pub created_before: Option<String>,
    pub revisit: bool,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub body_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub notes_total: i64,
    pub notes_active: i64,
    pub notes_pinned: i64,
    pub notes_archived: i64,
    pub notes_trashed: i64,
    pub tags: i64,
    pub spaces: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub excerpt: String,
    pub score: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct NoteSearch {
    pub text: String,
    pub any_term: bool,
    pub workspace_id: Option<String>,
    pub tag_id: Option<String>,
    pub is_archived: Option<bool>,
    pub pinned_only: bool,
    pub trashed: bool,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteMatch {
    pub note_id: String,
    pub title: String,
    pub body: String,
    pub excerpt: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_archived: bool,
    pub content_kind: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NoteSearchPage {
    pub matches: Vec<NoteMatch>,
    pub total: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentCleanup {
    pub count: usize,
    pub bytes: u64,
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    pub note_id: String,
    pub target_id: String,
    pub kind: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSuggestion {
    pub note_id: String,
    pub note_title: String,
    pub space_id: String,
    pub space_name: String,
    pub probability: f64,
    pub reasons: Vec<SuggestionReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagSuggestion {
    pub tag: String,
    pub probability: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionReason {
    pub label: String,
    pub kind: String,
}
