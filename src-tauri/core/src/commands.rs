use crate::attachments::Attachments;
use crate::sheet::Sheet;
use crate::types::*;
use crate::{AppError, Store};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};

pub const NOTES_CHANGED: &str = "notes:changed";
pub const TAGS_CHANGED: &str = "tags:changed";
pub const WORKSPACES_CHANGED: &str = "workspaces:changed";
pub const ATTACHMENTS_URL: &str = "/api/attachments";
pub const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const CLEANUP_GRACE_SECS: u64 = 3600;

pub const WEB_COMMANDS: &[&str] = &[
    "create_note",
    "get_note",
    "update_note",
    "soft_delete_note",
    "restore_note",
    "list_notes",
    "count_notes",
    "search_notes",
    "set_notes_flags",
    "soft_delete_notes",
    "restore_notes",
    "destroy_notes",
    "sheet_csv",
    "list_tags",
    "update_tag",
    "delete_tag",
    "add_tag_to_note",
    "remove_tag_from_note",
    "tags_for_note",
    "list_workspaces",
    "get_or_create_workspace",
    "rename_workspace",
    "delete_workspace",
    "list_workspace_tags",
    "add_note_to_workspace",
    "remove_note_from_workspace",
    "workspaces_for_note",
    "get_setting",
    "set_setting",
    "delete_setting",
    "library_graph",
    "space_suggestions",
    "tag_suggestion",
    "dismiss_space_suggestion",
    "restore_space_suggestion",
    "library_stats",
    "get_attachments_dir",
    "unused_attachments",
    "remove_unused_attachments",
    "app_version",
];

#[derive(Clone, Debug)]
pub struct Change {
    pub event: &'static str,
    pub payload: Value,
}

impl Change {
    pub fn new(event: &'static str, payload: Value) -> Self {
        Change { event, payload }
    }
}

pub struct Outcome {
    pub value: Value,
    pub changes: Vec<Change>,
}

fn args_of(args: &Value) -> Result<&Map<String, Value>, AppError> {
    match args {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(EMPTY.get_or_init(Map::new)),
        _ => Err(AppError::Validation("arguments must be an object".into())),
    }
}

static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();

fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, AppError> {
    let value = args_of(args)?
        .get(name)
        .cloned()
        .ok_or_else(|| AppError::Validation(format!("missing argument {name}")))?;
    serde_json::from_value(value).map_err(|e| AppError::Validation(format!("argument {name}: {e}")))
}

fn opt<T: DeserializeOwned>(args: &Value, name: &str) -> Result<Option<T>, AppError> {
    match args_of(args)?.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|e| AppError::Validation(format!("argument {name}: {e}"))),
    }
}

fn out<T: Serialize>(value: T) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(|e| AppError::Storage(format!("cannot encode reply: {e}")))
}

fn note_change(note: &Note, origin: Option<&str>) -> Change {
    Change::new(
        NOTES_CHANGED,
        json!({ "noteId": note.id, "updatedAt": note.updated_at, "origin": origin }),
    )
}

fn notes_changed(origin: Option<&str>) -> Change {
    Change::new(NOTES_CHANGED, json!({ "origin": origin }))
}

fn tags_changed() -> Change {
    Change::new(TAGS_CHANGED, Value::Null)
}

fn workspaces_changed() -> Change {
    Change::new(WORKSPACES_CHANGED, Value::Null)
}

fn attachment_sizes(
    store: &Store,
    place: &Attachments,
    grace: bool,
) -> Result<Vec<(String, u64)>, AppError> {
    match place {
        Attachments::Folder(dir) => {
            let cutoff = grace.then(|| {
                std::time::SystemTime::now() - std::time::Duration::from_secs(CLEANUP_GRACE_SECS)
            });
            crate::attachments::list_attachments(dir, cutoff)
                .map_err(|e| AppError::Storage(format!("could not list attachments: {e}")))
        }
        Attachments::Database => store.attachment_file_sizes(),
    }
}

fn unused_attachment_files(
    store: &Store,
    place: &Attachments,
) -> Result<(Vec<String>, AttachmentCleanup), AppError> {
    let files = attachment_sizes(store, place, true)?;
    let unused = store.unreferenced_attachments(files.iter().map(|(n, _)| n.clone()))?;
    let bytes = files
        .iter()
        .filter(|(n, _)| unused.contains(n))
        .map(|(_, size)| size)
        .sum();
    let summary = AttachmentCleanup {
        count: unused.len(),
        bytes,
    };
    Ok((unused, summary))
}

fn remove_unreferenced(
    store: &Store,
    place: &Attachments,
    names: impl IntoIterator<Item = String>,
) -> Result<AttachmentCleanup, AppError> {
    match place {
        Attachments::Folder(dir) => store.remove_unreferenced_attachments(dir, names),
        Attachments::Database => {
            let mut done = AttachmentCleanup::default();
            for name in store.unreferenced_attachments(names)? {
                if let Some(bytes) = store.delete_attachment_file(&name)? {
                    done.count += 1;
                    done.bytes += bytes;
                }
            }
            Ok(done)
        }
    }
}

pub fn dispatch(
    store: &mut Store,
    place: &Attachments,
    cmd: &str,
    args: &Value,
    origin: Option<&str>,
) -> Result<Outcome, AppError> {
    let mut changes = Vec::new();
    let value = match cmd {
        "create_note" => {
            let note = store.create_note(arg(args, "input")?)?;
            changes.push(note_change(&note, origin));
            changes.push(tags_changed());
            out(note)?
        }
        "get_note" => {
            let touch: Option<bool> = opt(args, "touch")?;
            out(store.get_note(&arg::<String>(args, "id")?, touch.unwrap_or(false))?)?
        }
        "update_note" => {
            let mut note = store.update_note(&arg::<String>(args, "id")?, arg(args, "patch")?)?;
            changes.push(note_change(&note, origin));
            changes.push(tags_changed());
            note.surface_data = None;
            out(note)?
        }
        "sheet_csv" => {
            let note = store.get_note(&arg::<String>(args, "id")?, false)?;
            if note.content_kind != CONTENT_KIND_SHEET {
                return Err(AppError::Validation("only a sheet exports as CSV".into()));
            }
            let sheet = Sheet::parse(note.surface_data.as_deref().unwrap_or_default())
                .map_err(AppError::Validation)?;
            out(sheet.csv())?
        }
        "soft_delete_note" => {
            let note = store.soft_delete_note(&arg::<String>(args, "id")?)?;
            changes.push(note_change(&note, origin));
            out(note)?
        }
        "restore_note" => {
            let note = store.restore_note(&arg::<String>(args, "id")?)?;
            changes.push(note_change(&note, origin));
            out(note)?
        }
        "list_notes" => {
            let filter: Option<NoteFilter> = opt(args, "filter")?;
            out(store.list_notes(filter.unwrap_or_default())?)?
        }
        "count_notes" => {
            let filter: Option<NoteFilter> = opt(args, "filter")?;
            out(store.count_notes(&filter.unwrap_or_default())?)?
        }
        "search_notes" => {
            let limit: Option<i64> = opt(args, "limit")?;
            out(store.search_notes(&arg::<String>(args, "text")?, limit.unwrap_or(50))?)?
        }
        "set_notes_flags" => {
            let ids: Vec<String> = arg(args, "ids")?;
            store.set_notes_flags(&ids, opt(args, "isPinned")?, opt(args, "isArchived")?)?;
            changes.push(notes_changed(origin));
            changes.push(tags_changed());
            Value::Null
        }
        "soft_delete_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            store.soft_delete_notes(&ids)?;
            changes.push(notes_changed(origin));
            Value::Null
        }
        "restore_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            store.restore_notes(&ids)?;
            changes.push(notes_changed(origin));
            Value::Null
        }
        "destroy_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            let confirm: bool = arg(args, "confirm")?;
            let names = store.attachment_names_of(&ids)?;
            store.destroy_notes(&ids, confirm)?;
            if !names.is_empty() {
                let _ = remove_unreferenced(store, place, names);
            }
            changes.push(notes_changed(origin));
            changes.push(tags_changed());
            Value::Null
        }
        "list_tags" => out(store.list_tags()?)?,
        "update_tag" => {
            let tag = store.update_tag(
                &arg::<String>(args, "id")?,
                opt(args, "name")?,
                opt(args, "color")?,
            )?;
            changes.push(tags_changed());
            out(tag)?
        }
        "delete_tag" => {
            store.delete_tag(&arg::<String>(args, "id")?)?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "add_tag_to_note" => {
            let tag = store.add_tag_to_note(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "name")?,
            )?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            out(tag)?
        }
        "remove_tag_from_note" => {
            store.remove_tag_from_note(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "tagId")?,
            )?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "tags_for_note" => out(store.tags_for_note(&arg::<String>(args, "noteId")?)?)?,
        "list_workspaces" => out(store.list_workspaces()?)?,
        "get_or_create_workspace" => {
            let ws = store.get_or_create_workspace(&arg::<String>(args, "name")?)?;
            changes.push(workspaces_changed());
            out(ws)?
        }
        "rename_workspace" => {
            let ws = store
                .rename_workspace(&arg::<String>(args, "id")?, &arg::<String>(args, "name")?)?;
            changes.push(workspaces_changed());
            out(ws)?
        }
        "delete_workspace" => {
            let members = store.delete_workspace(&arg::<String>(args, "id")?)?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            out(members)?
        }
        "list_workspace_tags" => {
            out(store.list_workspace_tags(&arg::<String>(args, "workspaceId")?)?)?
        }
        "add_note_to_workspace" => {
            store.add_note_to_workspace(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "workspaceId")?,
            )?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "remove_note_from_workspace" => {
            store.remove_note_from_workspace(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "workspaceId")?,
            )?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "workspaces_for_note" => out(store.workspaces_for_note(&arg::<String>(args, "noteId")?)?)?,
        "get_setting" => out(store.get_setting(&arg::<String>(args, "key")?)?)?,
        "set_setting" => {
            store.set_setting(&arg::<String>(args, "key")?, arg(args, "value")?)?;
            Value::Null
        }
        "delete_setting" => {
            store.delete_setting(&arg::<String>(args, "key")?)?;
            Value::Null
        }
        "library_graph" => out(store.library_graph()?)?,
        "space_suggestions" => out(store.space_suggestions()?)?,
        "tag_suggestion" => out(store.tag_suggestion(&arg::<String>(args, "noteId")?)?)?,
        "dismiss_space_suggestion" => {
            store.dismiss_space_suggestion(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "spaceId")?,
            )?;
            Value::Null
        }
        "restore_space_suggestion" => {
            store.restore_space_suggestion(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "spaceId")?,
            )?;
            Value::Null
        }
        "library_stats" => {
            let mut stats = out(store.library_stats()?)?;
            let files = attachment_sizes(store, place, false).unwrap_or_default();
            let bytes: u64 = files.iter().map(|(_, size)| size).sum();
            if let Value::Object(map) = &mut stats {
                map.insert("attachmentsCount".into(), json!(files.len()));
                map.insert("attachmentsBytes".into(), json!(bytes));
            }
            stats
        }
        "get_merge_review" => out(store.merge_review()?)?,
        "settle_merge_pair" => {
            let keep: Option<String> = opt(args, "keep")?;
            store.settle_pair(
                &arg::<String>(args, "a")?,
                &arg::<String>(args, "b")?,
                keep.as_deref(),
            )?;
            changes.push(notes_changed(origin));
            out(store.merge_review()?)?
        }
        "undo_merge_combine" => {
            store.undo_combine(&arg::<String>(args, "trashed")?)?;
            changes.push(notes_changed(origin));
            out(store.merge_review()?)?
        }
        "clear_merge_review" => {
            store.clear_review()?;
            Value::Null
        }
        "get_attachments_dir" => json!(ATTACHMENTS_URL),
        "unused_attachments" => out(unused_attachment_files(store, place)?.1)?,
        "remove_unused_attachments" => {
            let (unused, _) = unused_attachment_files(store, place)?;
            out(remove_unreferenced(store, place, unused)?)?
        }
        _ => return Err(AppError::NotFound(format!("command {cmd}"))),
    };
    Ok(Outcome { value, changes })
}

pub fn attachment_name(ext: &str) -> Result<String, AppError> {
    let ext = ext.to_ascii_lowercase();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Validation(format!(
            "unsupported attachment type: {ext:?}"
        )));
    }
    Ok(format!("{}.{ext}", uuid::Uuid::new_v4()))
}

pub fn valid_attachment_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && ATTACHMENT_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}
