//! SQLite-backed store: the single writer for all persistent state.
//! FTS5 is kept in sync by triggers; tag search goes through note_tags joins,
//! never FTS.

use crate::domain;
use crate::error::{AppError, Result};
use crate::types::*;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use uuid::Uuid;

const MIGRATIONS: &[&str] = &[
    // v1 — initial schema
    r#"
CREATE TABLE notes (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  title_is_auto  INTEGER NOT NULL DEFAULT 1,
  body           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_opened_at TEXT,
  is_pinned      INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  sync_state     TEXT NOT NULL DEFAULT 'local_only',
  version        INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT
);
CREATE INDEX idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);
CREATE INDEX idx_notes_flags ON notes(is_deleted, is_archived, is_pinned);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE note_tags (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- content_rowid is an explicit INTEGER PRIMARY KEY alias (`seq`), per the
-- FTS5 external-content documentation pattern; the implicit rowid is not
-- guaranteed stable across VACUUM.
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  content='notes', content_rowid='seq',
  tokenize='porter unicode61'
);

CREATE TRIGGER notes_after_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, body ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
"#,
];

const NOTE_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at, sync_state, version, last_synced_at";

pub struct Store {
    conn: Connection,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
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
        sync_state: row.get(10)?,
        version: row.get(11)?,
        last_synced_at: row.get(12)?,
    })
}

fn row_to_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// Get-or-create a tag inside an existing transaction/connection.
fn tag_get_or_create(conn: &Connection, raw_name: &str) -> Result<Tag> {
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

/// Attach a tag to a note (idempotent).
fn attach_tag(conn: &Connection, note_id: &str, tag_id: &str, source: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at, source) \
         VALUES (?1, ?2, ?3, ?4)",
        params![note_id, tag_id, now_iso(), source],
    )?;
    Ok(())
}

/// Build an FTS5 MATCH expression from raw user text. Tokens are reduced to
/// word characters so user input can never produce FTS syntax errors.
fn fts_match_expr(text: &str) -> Option<String> {
    let tokens: Vec<String> = text
        .split_whitespace()
        .map(|t| {
            t.chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect::<String>()
        })
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
                .join(" "),
        )
    }
}

impl Store {
    /// Open (creating if needed) the database: WAL mode, foreign keys on,
    /// quick integrity check, migrations applied.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0))?;
        Self::init(conn)
    }

    /// In-memory store for tests that don't need restart semantics.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(AppError::Storage(format!(
                "database integrity check failed: {check}"
            )));
        }
        let mut store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let current: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (idx, sql) in MIGRATIONS.iter().enumerate() {
            let target = (idx + 1) as i64;
            if target <= current {
                continue;
            }
            let tx = self
                .conn
                .transaction()
                .map_err(|e| AppError::Migration(e.to_string()))?;
            tx.execute_batch(sql)
                .map_err(|e| AppError::Migration(format!("migration v{target} failed: {e}")))?;
            tx.pragma_update(None, "user_version", target)
                .map_err(|e| AppError::Migration(e.to_string()))?;
            tx.commit()
                .map_err(|e| AppError::Migration(e.to_string()))?;
        }
        Ok(())
    }

    fn fetch_note(&self, id: &str) -> Result<Note> {
        self.conn
            .query_row(
                &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"),
                params![id],
                row_to_note,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("note {id} not found")))
    }

    // ---- notes ----

    pub fn create_note(&mut self, input: CreateNoteInput) -> Result<Note> {
        let body = input.body.unwrap_or_default();
        let explicit_title = input
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let title_is_auto = explicit_title.is_none();
        let title = explicit_title.unwrap_or_else(|| domain::derive_title(&body));
        let inline_tags = domain::extract_inline_tags(&body);
        let now = now_iso();
        let id = new_id();

        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO notes (id, title, title_is_auto, body, created_at, updated_at, \
             sync_state, version) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'local_only', 1)",
            params![id, title, i64::from(title_is_auto), body, now],
        )?;
        for name in &inline_tags {
            let tag = tag_get_or_create(&tx, name)?;
            attach_tag(&tx, &id, &tag.id, "inline")?;
        }
        for name in &input.tags {
            let tag = tag_get_or_create(&tx, name)?;
            attach_tag(&tx, &id, &tag.id, "manual")?;
        }
        tx.commit()?;
        self.fetch_note(&id)
    }

    /// Fetch a note. When `touch` is true, updates `last_opened_at`.
    pub fn get_note(&mut self, id: &str, touch: bool) -> Result<Note> {
        if touch {
            self.conn.execute(
                "UPDATE notes SET last_opened_at = ?1 WHERE id = ?2",
                params![now_iso(), id],
            )?;
        }
        self.fetch_note(id)
    }

    pub fn update_note(&mut self, id: &str, patch: UpdateNotePatch) -> Result<Note> {
        // Ensure existence first for a clean NOT_FOUND.
        self.fetch_note(id)?;
        let title_is_auto: bool = self
            .conn
            .query_row(
                "SELECT title_is_auto FROM notes WHERE id = ?1",
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .map(|v| v != 0)?;

        // An explicit title pins the title; an auto title follows body edits.
        let explicit_title = patch
            .title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let (new_title, new_title_is_auto) = match (&explicit_title, &patch.body) {
            (Some(t), _) => (Some(t.clone()), Some(false)),
            (None, Some(body)) if title_is_auto => (Some(domain::derive_title(body)), None),
            _ => (None, None),
        };

        let now = now_iso();
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE notes SET \
               title = COALESCE(?1, title), \
               title_is_auto = COALESCE(?2, title_is_auto), \
               body = COALESCE(?3, body), \
               is_pinned = COALESCE(?4, is_pinned), \
               is_archived = COALESCE(?5, is_archived), \
               updated_at = ?6, \
               version = version + 1 \
             WHERE id = ?7",
            params![
                new_title,
                new_title_is_auto.map(i64::from),
                patch.body.as_deref(),
                patch.is_pinned.map(i64::from),
                patch.is_archived.map(i64::from),
                now,
                id
            ],
        )?;
        if let Some(body) = &patch.body {
            for name in domain::extract_inline_tags(body) {
                let tag = tag_get_or_create(&tx, &name)?;
                attach_tag(&tx, id, &tag.id, "inline")?;
            }
        }
        tx.commit()?;
        self.fetch_note(id)
    }

    pub fn soft_delete_note(&mut self, id: &str) -> Result<Note> {
        self.fetch_note(id)?;
        let now = now_iso();
        self.conn.execute(
            "UPDATE notes SET is_deleted = 1, deleted_at = ?1, updated_at = ?1, \
             version = version + 1 WHERE id = ?2",
            params![now, id],
        )?;
        self.fetch_note(id)
    }

    pub fn restore_note(&mut self, id: &str) -> Result<Note> {
        self.fetch_note(id)?;
        let now = now_iso();
        self.conn.execute(
            "UPDATE notes SET is_deleted = 0, deleted_at = NULL, updated_at = ?1, \
             version = version + 1 WHERE id = ?2",
            params![now, id],
        )?;
        self.fetch_note(id)
    }

    /// Permanent deletion requires `confirm == true` (VALIDATION_ERROR otherwise).
    pub fn permanently_delete_note(&mut self, id: &str, confirm: bool) -> Result<()> {
        if !confirm {
            return Err(AppError::Validation(
                "permanent deletion requires explicit confirmation".into(),
            ));
        }
        self.fetch_note(id)?;
        // FK cascade removes note_tags; the AFTER DELETE trigger removes FTS rows.
        self.conn
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Default filter excludes archived and deleted notes; sorts by
    /// updatedAt desc.
    pub fn list_notes(&self, filter: NoteFilter) -> Result<Vec<Note>> {
        let mut conditions: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        let deleted = filter.is_deleted.unwrap_or(false);
        conditions.push("is_deleted = ?".into());
        args.push(Box::new(i64::from(deleted)));

        if !deleted {
            conditions.push("is_archived = ?".into());
            args.push(Box::new(i64::from(filter.is_archived.unwrap_or(false))));
        } else if let Some(archived) = filter.is_archived {
            conditions.push("is_archived = ?".into());
            args.push(Box::new(i64::from(archived)));
        }

        if let Some(pinned) = filter.is_pinned {
            conditions.push("is_pinned = ?".into());
            args.push(Box::new(i64::from(pinned)));
        }

        if !filter.tag_ids.is_empty() {
            let placeholders = vec!["?"; filter.tag_ids.len()].join(", ");
            conditions.push(format!(
                "id IN (SELECT note_id FROM note_tags WHERE tag_id IN ({placeholders}))"
            ));
            for tag_id in &filter.tag_ids {
                args.push(Box::new(tag_id.clone()));
            }
        }

        if let Some(query) = filter.query.as_ref().filter(|q| !q.trim().is_empty()) {
            conditions.push("(title LIKE ? OR body LIKE ?)".into());
            let like = format!("%{}%", query.trim());
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }

        let order_column = match filter.sort_by.as_deref() {
            Some("createdAt") => "created_at",
            Some("lastOpenedAt") => "last_opened_at",
            Some("title") => "title COLLATE NOCASE",
            _ => "updated_at",
        };
        let order_dir = match filter.sort_order.as_deref() {
            Some("asc") => "ASC",
            _ => "DESC",
        };
        let limit = filter.limit.unwrap_or(500).clamp(1, 5000);
        let offset = filter.offset.unwrap_or(0).max(0);

        let sql = format!(
            "SELECT {NOTE_COLUMNS} FROM notes WHERE {} ORDER BY {order_column} {order_dir} \
             LIMIT {limit} OFFSET {offset}",
            conditions.join(" AND ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
            row_to_note,
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Full-text search over title+body. Always excludes deleted notes;
    /// excludes archived notes. Special characters in `text` must not error.
    pub fn search_notes(&self, text: &str, limit: i64) -> Result<Vec<SearchResult>> {
        let Some(match_expr) = fts_match_expr(text) else {
            return Ok(Vec::new());
        };
        let limit = limit.clamp(1, 500);
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.title, snippet(notes_fts, 1, '', '', '…', 12), \
                    bm25(notes_fts), n.updated_at \
             FROM notes_fts \
             JOIN notes n ON n.seq = notes_fts.rowid \
             WHERE notes_fts MATCH ?1 AND n.is_deleted = 0 AND n.is_archived = 0 \
             ORDER BY bm25(notes_fts) \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![match_expr, limit], |row| {
            Ok(SearchResult {
                note_id: row.get(0)?,
                title: row.get(1)?,
                excerpt: row.get(2)?,
                // bm25: lower is better (negative); expose higher-is-better.
                score: -row.get::<_, f64>(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---- tags ----

    pub fn get_or_create_tag(&mut self, name: &str) -> Result<Tag> {
        tag_get_or_create(&self.conn, name)
    }

    pub fn list_tags(&self) -> Result<Vec<TagWithCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at, \
                    (SELECT COUNT(*) FROM note_tags nt \
                       JOIN notes n ON n.id = nt.note_id \
                      WHERE nt.tag_id = t.id AND n.is_deleted = 0) AS usage_count \
             FROM tags t ORDER BY t.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TagWithCount {
                tag: row_to_tag(row)?,
                usage_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_tag(
        &mut self,
        id: &str,
        name: Option<String>,
        color: Option<String>,
    ) -> Result<Tag> {
        let existing = self
            .conn
            .query_row(
                "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?1",
                params![id],
                row_to_tag,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("tag {id} not found")))?;

        let new_name = match name {
            Some(raw) => {
                let normalized = domain::normalize_tag_name(&raw)
                    .ok_or_else(|| AppError::Validation("tag name must not be empty".into()))?;
                let clash: Option<String> = self
                    .conn
                    .query_row(
                        "SELECT id FROM tags WHERE name = ?1 AND id <> ?2",
                        params![normalized, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if clash.is_some() {
                    return Err(AppError::Conflict(format!(
                        "a tag named '{normalized}' already exists"
                    )));
                }
                normalized
            }
            None => existing.name,
        };

        self.conn.execute(
            "UPDATE tags SET name = ?1, color = COALESCE(?2, color), updated_at = ?3 WHERE id = ?4",
            params![new_name, color, now_iso(), id],
        )?;
        self.conn
            .query_row(
                "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?1",
                params![id],
                row_to_tag,
            )
            .map_err(Into::into)
    }

    /// Removes the tag and its associations; notes are untouched.
    pub fn delete_tag(&mut self, id: &str) -> Result<()> {
        let affected = self
            .conn
            .execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("tag {id} not found")));
        }
        Ok(())
    }

    pub fn add_tag_to_note(&mut self, note_id: &str, name: &str) -> Result<Tag> {
        self.fetch_note(note_id)?;
        let tag = tag_get_or_create(&self.conn, name)?;
        attach_tag(&self.conn, note_id, &tag.id, "manual")?;
        Ok(tag)
    }

    pub fn remove_tag_from_note(&mut self, note_id: &str, tag_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM note_tags WHERE note_id = ?1 AND tag_id = ?2",
            params![note_id, tag_id],
        )?;
        Ok(())
    }

    pub fn tags_for_note(&self, note_id: &str) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at \
             FROM tags t JOIN note_tags nt ON nt.tag_id = t.id \
             WHERE nt.note_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![note_id], row_to_tag)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---- settings ----

    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        match raw {
            None => Ok(None),
            Some(s) => serde_json::from_str(&s)
                .map(Some)
                .map_err(|e| AppError::Storage(format!("corrupt setting '{key}': {e}"))),
        }
    }

    pub fn set_setting(&mut self, key: &str, value: serde_json::Value) -> Result<()> {
        let serialized = serde_json::to_string(&value)
            .map_err(|e| AppError::Validation(format!("unserializable setting value: {e}")))?;
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
             updated_at = excluded.updated_at",
            params![key, serialized, now_iso()],
        )?;
        Ok(())
    }

    pub fn delete_setting(&mut self, key: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}
