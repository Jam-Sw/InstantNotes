use crate::events::{Change, NOTES_CHANGED, TAGS_CHANGED, WORKSPACES_CHANGED};
use crate::libraries::Library;
use instantnotes_core::sheet::Sheet;
use instantnotes_core::types::*;
use instantnotes_core::{AppError, Store};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::time::Duration;

pub const ATTACHMENTS_URL: &str = "/api/attachments";
pub const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const CLEANUP_GRACE: Duration = Duration::from_secs(3600);

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

fn unused_attachment_files(
    store: &Store,
    dir: &std::path::Path,
) -> Result<(Vec<String>, AttachmentCleanup), AppError> {
    let cutoff = std::time::SystemTime::now() - CLEANUP_GRACE;
    let files = instantnotes_core::attachments::list_attachments(dir, Some(cutoff))
        .map_err(|e| AppError::Storage(format!("could not list attachments: {e}")))?;
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

fn attachments_stats(dir: &std::path::Path) -> (i64, i64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    let (mut count, mut bytes) = (0i64, 0i64);
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                bytes += meta.len() as i64;
            }
        }
    }
    (count, bytes)
}

pub fn dispatch(
    lib: &mut Library,
    cmd: &str,
    args: &Value,
    origin: Option<&str>,
) -> Result<Outcome, AppError> {
    let mut changes = Vec::new();
    let value = match cmd {
        "create_note" => {
            let note = lib.store.create_note(arg(args, "input")?)?;
            changes.push(note_change(&note, origin));
            changes.push(tags_changed());
            out(note)?
        }
        "get_note" => {
            let touch: Option<bool> = opt(args, "touch")?;
            out(lib
                .store
                .get_note(&arg::<String>(args, "id")?, touch.unwrap_or(false))?)?
        }
        "update_note" => {
            let mut note = lib
                .store
                .update_note(&arg::<String>(args, "id")?, arg(args, "patch")?)?;
            changes.push(note_change(&note, origin));
            changes.push(tags_changed());
            note.surface_data = None;
            out(note)?
        }
        "sheet_csv" => {
            let note = lib.store.get_note(&arg::<String>(args, "id")?, false)?;
            if note.content_kind != CONTENT_KIND_SHEET {
                return Err(AppError::Validation("only a sheet exports as CSV".into()));
            }
            let sheet = Sheet::parse(note.surface_data.as_deref().unwrap_or_default())
                .map_err(AppError::Validation)?;
            out(sheet.csv())?
        }
        "soft_delete_note" => {
            let note = lib.store.soft_delete_note(&arg::<String>(args, "id")?)?;
            changes.push(note_change(&note, origin));
            out(note)?
        }
        "restore_note" => {
            let note = lib.store.restore_note(&arg::<String>(args, "id")?)?;
            changes.push(note_change(&note, origin));
            out(note)?
        }
        "list_notes" => {
            let filter: Option<NoteFilter> = opt(args, "filter")?;
            out(lib.store.list_notes(filter.unwrap_or_default())?)?
        }
        "count_notes" => {
            let filter: Option<NoteFilter> = opt(args, "filter")?;
            out(lib.store.count_notes(&filter.unwrap_or_default())?)?
        }
        "search_notes" => {
            let limit: Option<i64> = opt(args, "limit")?;
            out(lib
                .store
                .search_notes(&arg::<String>(args, "text")?, limit.unwrap_or(50))?)?
        }
        "set_notes_flags" => {
            let ids: Vec<String> = arg(args, "ids")?;
            lib.store
                .set_notes_flags(&ids, opt(args, "isPinned")?, opt(args, "isArchived")?)?;
            changes.push(notes_changed(origin));
            changes.push(tags_changed());
            Value::Null
        }
        "soft_delete_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            lib.store.soft_delete_notes(&ids)?;
            changes.push(notes_changed(origin));
            Value::Null
        }
        "restore_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            lib.store.restore_notes(&ids)?;
            changes.push(notes_changed(origin));
            Value::Null
        }
        "destroy_notes" => {
            let ids: Vec<String> = arg(args, "ids")?;
            let confirm: bool = arg(args, "confirm")?;
            let names = lib.store.attachment_names_of(&ids)?;
            lib.store.destroy_notes(&ids, confirm)?;
            if !names.is_empty() {
                let _ = lib
                    .store
                    .remove_unreferenced_attachments(&lib.attachments, names);
            }
            changes.push(notes_changed(origin));
            changes.push(tags_changed());
            Value::Null
        }
        "list_tags" => out(lib.store.list_tags()?)?,
        "update_tag" => {
            let tag = lib.store.update_tag(
                &arg::<String>(args, "id")?,
                opt(args, "name")?,
                opt(args, "color")?,
            )?;
            changes.push(tags_changed());
            out(tag)?
        }
        "delete_tag" => {
            lib.store.delete_tag(&arg::<String>(args, "id")?)?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "add_tag_to_note" => {
            let tag = lib.store.add_tag_to_note(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "name")?,
            )?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            out(tag)?
        }
        "remove_tag_from_note" => {
            lib.store.remove_tag_from_note(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "tagId")?,
            )?;
            changes.push(tags_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "tags_for_note" => out(lib.store.tags_for_note(&arg::<String>(args, "noteId")?)?)?,
        "list_workspaces" => out(lib.store.list_workspaces()?)?,
        "get_or_create_workspace" => {
            let ws = lib
                .store
                .get_or_create_workspace(&arg::<String>(args, "name")?)?;
            changes.push(workspaces_changed());
            out(ws)?
        }
        "rename_workspace" => {
            let ws = lib
                .store
                .rename_workspace(&arg::<String>(args, "id")?, &arg::<String>(args, "name")?)?;
            changes.push(workspaces_changed());
            out(ws)?
        }
        "delete_workspace" => {
            let members = lib.store.delete_workspace(&arg::<String>(args, "id")?)?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            out(members)?
        }
        "list_workspace_tags" => out(lib
            .store
            .list_workspace_tags(&arg::<String>(args, "workspaceId")?)?)?,
        "add_note_to_workspace" => {
            lib.store.add_note_to_workspace(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "workspaceId")?,
            )?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "remove_note_from_workspace" => {
            lib.store.remove_note_from_workspace(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "workspaceId")?,
            )?;
            changes.push(workspaces_changed());
            changes.push(notes_changed(origin));
            Value::Null
        }
        "workspaces_for_note" => out(lib
            .store
            .workspaces_for_note(&arg::<String>(args, "noteId")?)?)?,
        "get_setting" => out(lib.store.get_setting(&arg::<String>(args, "key")?)?)?,
        "set_setting" => {
            lib.store
                .set_setting(&arg::<String>(args, "key")?, arg(args, "value")?)?;
            Value::Null
        }
        "delete_setting" => {
            lib.store.delete_setting(&arg::<String>(args, "key")?)?;
            Value::Null
        }
        "library_graph" => out(lib.store.library_graph()?)?,
        "space_suggestions" => out(lib.store.space_suggestions()?)?,
        "tag_suggestion" => out(lib.store.tag_suggestion(&arg::<String>(args, "noteId")?)?)?,
        "dismiss_space_suggestion" => {
            lib.store.dismiss_space_suggestion(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "spaceId")?,
            )?;
            Value::Null
        }
        "restore_space_suggestion" => {
            lib.store.restore_space_suggestion(
                &arg::<String>(args, "noteId")?,
                &arg::<String>(args, "spaceId")?,
            )?;
            Value::Null
        }
        "library_stats" => {
            let mut stats = out(lib.store.library_stats()?)?;
            let (count, bytes) = attachments_stats(&lib.attachments);
            if let Value::Object(map) = &mut stats {
                map.insert("attachmentsCount".into(), json!(count));
                map.insert("attachmentsBytes".into(), json!(bytes));
            }
            stats
        }
        "get_attachments_dir" => json!(ATTACHMENTS_URL),
        "unused_attachments" => out(unused_attachment_files(&lib.store, &lib.attachments)?.1)?,
        "remove_unused_attachments" => {
            let (unused, _) = unused_attachment_files(&lib.store, &lib.attachments)?;
            out(lib
                .store
                .remove_unreferenced_attachments(&lib.attachments, unused)?)?
        }
        "app_version" => json!(env!("CARGO_PKG_VERSION")),
        _ => return Err(AppError::NotFound(format!("command {cmd}"))),
    };
    Ok(Outcome { value, changes })
}

pub fn save_attachment(lib: &Library, bytes: &[u8], ext: &str) -> Result<String, AppError> {
    let ext = ext.to_ascii_lowercase();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Validation(format!(
            "unsupported attachment type: {ext:?}"
        )));
    }
    if bytes.is_empty() {
        return Err(AppError::Validation("attachment is empty".into()));
    }
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    std::fs::write(lib.attachments.join(&name), bytes)
        .map_err(|e| AppError::Storage(format!("could not write attachment: {e}")))?;
    Ok(name)
}

pub fn attachment_path(lib: &Library, name: &str) -> Option<std::path::PathBuf> {
    let (stem, ext) = name.rsplit_once('.')?;
    let safe = !stem.is_empty()
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    (safe && ATTACHMENT_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .then(|| lib.attachments.join(name))
}
