//! SQLite-backed store: the single writer for all persistent state.
//! FTS5 is kept in sync by triggers; tag search goes through note_tags joins,
//! never FTS.

use crate::domain;
use crate::error::{AppError, Result};
use crate::types::*;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Ordered schema migrations; user_version tracks how many have run. Public so
/// tests can build fixtures at a historical schema version.
pub const MIGRATIONS: &[&str] = &[
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
    // v2 — workspaces: named note collections, many-to-many like tags
    r#"
CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE note_workspaces (
  note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (note_id, workspace_id)
);
CREATE INDEX idx_note_workspaces_ws ON note_workspaces(workspace_id);
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

fn row_to_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

const WORKSPACE_COLUMNS: &str = "id, name, created_at, updated_at";

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
    /// Open (creating if needed) the database: WAL mode, a 5s busy timeout,
    /// synchronous=NORMAL, foreign keys on, quick integrity check, migrations
    /// applied.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        // Wait for a competing writer instead of failing immediately with
        // SQLITE_BUSY. The same file is legitimately opened by more than one
        // process (a dev build alongside the installed release, or a second
        // launch), so a writer can briefly hold the lock; without a timeout that
        // surfaces to the user as a hard "database is locked" error.
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| AppError::Storage(format!("cannot set busy timeout: {e}")))?;
        // A filesystem that refuses WAL (some network mounts) leaves the
        // connection silently in rollback mode, defeating the crash-safety this
        // app relies on; treat that as an unusable storage location.
        let journal_mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            return Err(AppError::Storage(format!(
                "storage location does not support WAL journaling (got '{journal_mode}')"
            )));
        }
        // NORMAL is the standard, crash-safe pairing with WAL: fsync at
        // checkpoints rather than on every commit. Safe against app crashes; only
        // an OS crash or power loss can drop commits still sitting in the WAL.
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| AppError::Storage(format!("cannot set synchronous mode: {e}")))?;
        // Snapshot an existing library before it is migrated so a failed or
        // buggy migration is always recoverable.
        Self::backup_before_migration(path, &conn)?;
        Self::init(conn)
    }

    /// Open the store, recovering from a corrupt database file by setting it
    /// aside and starting fresh. The returned bool is true only when recovery
    /// happened. Non-corruption failures (permissions, a WAL-hostile mount)
    /// propagate unchanged so a transient or fixable problem never discards
    /// good data.
    pub fn open_or_recover(path: &Path) -> Result<(Self, bool)> {
        match Self::open(path) {
            Ok(store) => Ok((store, false)),
            Err(e) if e.is_corruption() => {
                Self::move_corrupt_aside(path)?;
                let store = Self::open(path)?;
                Ok((store, true))
            }
            Err(e) => Err(e),
        }
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
            return Err(AppError::Corruption(format!(
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
        // A user_version past the last known migration means this file was
        // written by a newer build; its schema is unknown to us, so refuse
        // rather than run queries that assume the older shape.
        if current > MIGRATIONS.len() as i64 {
            return Err(AppError::Migration(format!(
                "database schema v{current} was created by a newer version of \
                 the app (this build knows up to v{})",
                MIGRATIONS.len()
            )));
        }
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

    /// Copy an existing library aside before migrating it. Runs only for a file
    /// that already carries a schema older than the current one (0 < v < len);
    /// a brand-new file has nothing to lose and a current file is not migrated.
    /// A backup failure fails the open rather than migrating without a net.
    fn backup_before_migration(path: &Path, conn: &Connection) -> Result<()> {
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current <= 0 || current >= MIGRATIONS.len() as i64 {
            return Ok(());
        }
        let mut backup = path.as_os_str().to_os_string();
        backup.push(format!(".backup-v{current}"));
        let backup_path = PathBuf::from(backup);
        // VACUUM INTO refuses to overwrite; clear any leftover from a prior
        // interrupted attempt first.
        if backup_path.exists() {
            std::fs::remove_file(&backup_path)
                .map_err(|e| AppError::Storage(format!("cannot clear stale backup: {e}")))?;
        }
        // The path is interpolated as a SQL string literal, so double any single
        // quotes it contains.
        let escaped = backup_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{escaped}'"))
            .map_err(|e| match AppError::from(e) {
                // A corrupt source keeps its classification so open_or_recover
                // can still set the file aside instead of giving up.
                AppError::Corruption(msg) => {
                    AppError::Corruption(format!("pre-migration backup failed: {msg}"))
                }
                other => AppError::Storage(format!("pre-migration backup failed: {other}")),
            })?;
        Ok(())
    }

    /// Rename a corrupt database and its WAL/SHM siblings to a free
    /// ".corrupt-N" suffix so a fresh store can be created at the same path
    /// without clobbering the salvaged file.
    fn move_corrupt_aside(path: &Path) -> Result<()> {
        let mut n = 1;
        let target = loop {
            let mut candidate = path.as_os_str().to_os_string();
            candidate.push(format!(".corrupt-{n}"));
            let candidate = PathBuf::from(candidate);
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
        };
        std::fs::rename(path, &target)
            .map_err(|e| AppError::Storage(format!("cannot set corrupt database aside: {e}")))?;
        // WAL/SHM belong to the corrupt file; move them out of the way too so
        // the fresh database starts clean. They may be absent.
        for ext in ["-wal", "-shm"] {
            let mut sibling = path.as_os_str().to_os_string();
            sibling.push(ext);
            let sibling = PathBuf::from(sibling);
            if sibling.exists() {
                let mut sibling_target = target.as_os_str().to_os_string();
                sibling_target.push(ext);
                let _ = std::fs::rename(&sibling, PathBuf::from(sibling_target));
            }
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
        let existing = self.fetch_note(id)?;
        // An empty patch is a no-op: skip the UPDATE so version and updated_at
        // are not bumped and recency-sorted lists keep their order.
        if patch.title.is_none()
            && patch.body.is_none()
            && patch.is_pinned.is_none()
            && patch.is_archived.is_none()
        {
            return Ok(existing);
        }
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
            // Reconcile inline tags with the new body: attach the tags it now
            // mentions, then detach any inline-sourced edge whose #token is
            // gone so removing a tag chip is not undone by the next save.
            // Manual edges are pinned and never touched by a body edit.
            let mut kept_ids: Vec<String> = Vec::new();
            for name in domain::extract_inline_tags(body) {
                let tag = tag_get_or_create(&tx, &name)?;
                attach_tag(&tx, id, &tag.id, "inline")?;
                kept_ids.push(tag.id);
            }
            if kept_ids.is_empty() {
                tx.execute(
                    "DELETE FROM note_tags WHERE note_id = ?1 AND source = 'inline'",
                    params![id],
                )?;
            } else {
                let placeholders = vec!["?"; kept_ids.len()].join(", ");
                let sql = format!(
                    "DELETE FROM note_tags WHERE note_id = ? AND source = 'inline' \
                     AND tag_id NOT IN ({placeholders})"
                );
                let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(kept_ids.len() + 1);
                args.push(&id);
                for tag_id in &kept_ids {
                    args.push(tag_id);
                }
                tx.execute(&sql, rusqlite::params_from_iter(args))?;
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

        if filter.never_opened == Some(true) {
            conditions.push("last_opened_at IS NULL".into());
        }

        if let Some(created_before) = &filter.created_before {
            // Timestamps are stored as UTC ISO-8601, so string comparison is
            // chronological; differing sub-second precision only moves the
            // boundary within a second, which no caller depends on.
            conditions.push("created_at < ?".into());
            args.push(Box::new(created_before.clone()));
        }

        if let Some(workspace_id) = &filter.workspace_id {
            conditions
                .push("id IN (SELECT note_id FROM note_workspaces WHERE workspace_id = ?)".into());
            args.push(Box::new(workspace_id.clone()));
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

        // Pinned notes float to the top of every live list; trash keeps
        // plain recency order.
        let pinned_first = if deleted { "" } else { "is_pinned DESC, " };
        let sql = format!(
            "SELECT {NOTE_COLUMNS} FROM notes WHERE {} \
             ORDER BY {pinned_first}{order_column} {order_dir} \
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
    /// Title and excerpt matches are bracketed with U+0001 (start) / U+0002
    /// (end) sentinels rather than HTML: both are control characters a user
    /// can never type, so the frontend can split on them unambiguously to
    /// highlight hits as plain-text segments (see `highlight.ts`).
    pub fn search_notes(&self, text: &str, limit: i64) -> Result<Vec<SearchResult>> {
        let Some(match_expr) = fts_match_expr(text) else {
            return Ok(Vec::new());
        };
        let limit = limit.clamp(1, 500);
        let mut stmt = self.conn.prepare(
            // 16 tokens, not the FTS5 default 15 or the prior 12: the list
            // row is single-line and CSS-truncated regardless, so a wider
            // window costs nothing visually and gives multi-word queries
            // enough room for more than one matched term to land together.
            // highlight() (not snippet()) for the title: titles are short, so
            // the full column with markers is what the row renders anyway. A
            // query matching only the title still shows why the note hit.
            "SELECT n.id, highlight(notes_fts, 0, '\u{1}', '\u{2}'), \
                    snippet(notes_fts, 1, '\u{1}', '\u{2}', '…', 16), \
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
        // attach_tag is INSERT OR IGNORE, so an edge already present as 'inline'
        // keeps that source. An explicit add is a pin, so promote it to
        // 'manual' and inline reconciliation will no longer detach it.
        self.conn.execute(
            "UPDATE note_tags SET source = 'manual' \
             WHERE note_id = ?1 AND tag_id = ?2 AND source = 'inline'",
            params![note_id, tag.id],
        )?;
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

    // ---- workspaces ----

    fn fetch_workspace(&self, id: &str) -> Result<Workspace> {
        self.conn
            .query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1"),
                params![id],
                row_to_workspace,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("workspace {id} not found")))
    }

    pub fn get_or_create_workspace(&mut self, raw_name: &str) -> Result<Workspace> {
        let name = domain::normalize_workspace_name(raw_name)
            .ok_or_else(|| AppError::Validation("workspace name must not be empty".into()))?;
        if let Some(ws) = self
            .conn
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
        self.conn.execute(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, name, now],
        )?;
        Ok(Workspace {
            id,
            name,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceWithCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT w.id, w.name, w.created_at, w.updated_at, \
                    (SELECT COUNT(*) FROM note_workspaces nw \
                       JOIN notes n ON n.id = nw.note_id \
                      WHERE nw.workspace_id = w.id AND n.is_deleted = 0) AS note_count \
             FROM workspaces w ORDER BY w.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceWithCount {
                workspace: row_to_workspace(row)?,
                note_count: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn rename_workspace(&mut self, id: &str, raw_name: &str) -> Result<Workspace> {
        self.fetch_workspace(id)?;
        let name = domain::normalize_workspace_name(raw_name)
            .ok_or_else(|| AppError::Validation("workspace name must not be empty".into()))?;
        let clash: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM workspaces WHERE name = ?1 AND id <> ?2",
                params![name, id],
                |r| r.get(0),
            )
            .optional()?;
        if clash.is_some() {
            return Err(AppError::Conflict(format!(
                "a workspace named '{name}' already exists"
            )));
        }
        self.conn.execute(
            "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_iso(), id],
        )?;
        self.fetch_workspace(id)
    }

    /// Removes the workspace and its memberships; notes are untouched.
    /// Returns the member note ids so the caller can offer an undo that
    /// re-adds every membership: a post-hoc `list_notes` snapshot can't,
    /// because its default filter hides archived and trashed members.
    pub fn delete_workspace(&mut self, id: &str) -> Result<Vec<String>> {
        self.fetch_workspace(id)?;
        let member_ids = {
            let mut stmt = self
                .conn
                .prepare("SELECT note_id FROM note_workspaces WHERE workspace_id = ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };
        self.conn
            .execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(member_ids)
    }

    /// Tags carried by a workspace's visible notes, with counts scoped to
    /// the workspace (the note list's tag chips). Archived and trashed
    /// members don't contribute: a chip must never filter the visible
    /// list down to zero matches for a tag the user can't see.
    pub fn list_workspace_tags(&self, workspace_id: &str) -> Result<Vec<TagWithCount>> {
        self.fetch_workspace(workspace_id)?;
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, t.updated_at, \
                    COUNT(*) AS usage_count \
             FROM tags t \
             JOIN note_tags nt ON nt.tag_id = t.id \
             JOIN note_workspaces nw ON nw.note_id = nt.note_id \
             JOIN notes n ON n.id = nt.note_id \
             WHERE nw.workspace_id = ?1 AND n.is_deleted = 0 AND n.is_archived = 0 \
             GROUP BY t.id ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![workspace_id], |row| {
            Ok(TagWithCount {
                tag: row_to_tag(row)?,
                usage_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Collect a note into a workspace (idempotent).
    pub fn add_note_to_workspace(&mut self, note_id: &str, workspace_id: &str) -> Result<()> {
        self.fetch_note(note_id)?;
        self.fetch_workspace(workspace_id)?;
        self.conn.execute(
            "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
             VALUES (?1, ?2, ?3)",
            params![note_id, workspace_id, now_iso()],
        )?;
        Ok(())
    }

    pub fn remove_note_from_workspace(&mut self, note_id: &str, workspace_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM note_workspaces WHERE note_id = ?1 AND workspace_id = ?2",
            params![note_id, workspace_id],
        )?;
        Ok(())
    }

    pub fn workspaces_for_note(&self, note_id: &str) -> Result<Vec<Workspace>> {
        let mut stmt = self.conn.prepare(
            "SELECT w.id, w.name, w.created_at, w.updated_at \
             FROM workspaces w JOIN note_workspaces nw ON nw.workspace_id = w.id \
             WHERE nw.note_id = ?1 ORDER BY w.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![note_id], row_to_workspace)?;
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

#[cfg(test)]
mod pragma_tests {
    use super::Store;
    use tempfile::tempdir;

    /// `open` must configure the on-disk database for safe concurrent access:
    /// WAL journaling, a non-zero busy timeout (so a competing writer is waited
    /// for rather than failing with SQLITE_BUSY), and synchronous=NORMAL.
    #[test]
    fn open_sets_concurrency_pragmas() {
        let dir = tempdir().unwrap();
        let store = Store::open(&dir.path().join("concurrency.db")).unwrap();

        let journal: String = store
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal.to_lowercase(), "wal");

        let busy_timeout: i64 = store
            .conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 5000);

        // 1 == NORMAL
        let synchronous: i64 = store
            .conn
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .unwrap();
        assert_eq!(synchronous, 1);
    }
}
