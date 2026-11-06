use crate::domain;
use crate::error::{AppError, Result};
use crate::types::*;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub(super) const NOTE_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at, content_kind, surface_data";

pub(super) const LIST_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at, content_kind, NULL";

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn iso(t: std::time::SystemTime) -> String {
    chrono::DateTime::<Utc>::from(t).to_rfc3339_opts(SecondsFormat::Micros, true)
}

pub(super) fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub(super) fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_opened_at: row.get(5)?,
        is_pinned: row.get::<_, i64>(6)? != 0,
        is_archived: row.get::<_, i64>(7)? != 0,
        is_deleted: row.get::<_, i64>(8)? != 0,
        deleted_at: row.get(9)?,
        content_kind: row.get(10)?,
        surface_data: row.get(11)?,
    })
}

pub(super) fn row_to_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

pub(super) fn row_to_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        flag: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub(super) const WORKSPACE_COLUMNS: &str = "id, name, color, flag, created_at, updated_at";

pub(super) fn validated_color(raw: &str) -> Result<String> {
    domain::normalize_color(raw).ok_or_else(|| {
        AppError::Validation(format!(
            "color must be one of {} or a #rrggbb value",
            domain::SWATCH_NAMES.join(", ")
        ))
    })
}

pub(super) fn tag_get_or_create(conn: &Connection, raw_name: &str) -> Result<Tag> {
    let name = domain::normalize_tag_name(raw_name)
        .ok_or_else(|| AppError::Validation("tag name must not be empty".into()))?;
    if let Some(tag) = conn
        .query_row(
            "SELECT id, name, color, created_at, updated_at FROM tags WHERE name = ?1",
            params![name],
            row_to_tag,
        )
        .optional()?
    {
        return Ok(tag);
    }
    let now = now_iso();
    let id = new_id();
    conn.execute(
        "INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(Tag {
        id,
        name,
        color: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub(super) fn workspace_get_or_create(conn: &Connection, raw_name: &str) -> Result<Workspace> {
    let name = domain::normalize_workspace_name(raw_name)
        .ok_or_else(|| AppError::Validation("workspace name must not be empty".into()))?;
    if let Some(ws) = conn
        .query_row(
            &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE name = ?1"),
            params![name],
            row_to_workspace,
        )
        .optional()?
    {
        return Ok(ws);
    }
    let now = now_iso();
    let id = new_id();
    conn.execute(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    Ok(Workspace {
        id,
        name,
        color: None,
        flag: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub(super) fn attach_tag(
    conn: &Connection,
    note_id: &str,
    tag_id: &str,
    source: &str,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at, source) \
         VALUES (?1, ?2, ?3, ?4)",
        params![note_id, tag_id, now_iso(), source],
    )?;
    Ok(())
}

pub(super) fn fts_match_expr(text: &str) -> Option<String> {
    fts_match_expr_with(text, false)
}

pub(super) fn fts_match_expr_with(text: &str, any_term: bool) -> Option<String> {
    let tokens: Vec<&str> = text
        .split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_'))
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(
            tokens
                .iter()
                .map(|t| format!("\"{t}\"*"))
                .collect::<Vec<_>>()
                .join(if any_term { " OR " } else { " " }),
        )
    }
}

pub(super) fn reconcile_inline_tags(tx: &Connection, note_id: &str, body: &str) -> Result<()> {
    let mut kept: Vec<String> = Vec::new();
    for name in domain::extract_inline_tags(body) {
        let tag = tag_get_or_create(tx, &name)?;
        attach_tag(tx, note_id, &tag.id, "inline")?;
        kept.push(tag.id);
    }
    if kept.is_empty() {
        tx.execute(
            "DELETE FROM note_tags WHERE note_id = ?1 AND source = 'inline'",
            params![note_id],
        )?;
        return Ok(());
    }
    let placeholders = vec!["?"; kept.len()].join(", ");
    let sql = format!(
        "DELETE FROM note_tags WHERE note_id = ? AND source = 'inline' \
         AND tag_id NOT IN ({placeholders})"
    );
    let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(kept.len() + 1);
    args.push(&note_id);
    for tag_id in &kept {
        args.push(tag_id);
    }
    tx.execute(&sql, rusqlite::params_from_iter(args))?;
    Ok(())
}
