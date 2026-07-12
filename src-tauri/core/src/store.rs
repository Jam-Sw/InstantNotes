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
    // v3: drop the unused sync scaffolding. These columns were written but
    // never read; a real sync feature will design its own schema when it lands.
    r#"
ALTER TABLE notes DROP COLUMN sync_state;
ALTER TABLE notes DROP COLUMN version;
ALTER TABLE notes DROP COLUMN last_synced_at;
"#,
];

const NOTE_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at";

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
}

mod notes;
mod settings;
mod stats;
mod tags;
mod workspaces;

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

#[cfg(test)]
mod migration_tests {
    use super::{Store, MIGRATIONS};
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn note_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(notes)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        cols
    }

    /// A database written by a pre-0.8 build (schema v2) still carries the sync
    /// columns. Opening it runs the v3 migration, which must drop them without
    /// losing any note.
    #[test]
    fn v3_drops_sync_columns_and_preserves_notes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.db");

        // Build a v2 database by hand, exactly as an older build left it.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATIONS[0]).unwrap();
            conn.execute_batch(MIGRATIONS[1]).unwrap();
            conn.pragma_update(None, "user_version", 2i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at, \
                 sync_state, version) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't', 'local_only', 3)",
                [],
            )
            .unwrap();
            assert!(note_columns(&conn).contains(&"sync_state".to_string()));
        }

        // Opening runs the pending v3 migration.
        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        assert!(!cols.contains(&"sync_state".to_string()));
        assert!(!cols.contains(&"version".to_string()));
        assert!(!cols.contains(&"last_synced_at".to_string()));

        // The note and its content survived the column drop.
        let note = store.get_note("n1", false).unwrap();
        assert_eq!(note.title, "Kept");
        assert_eq!(note.body, "the body");
        let all = store.list_notes(Default::default()).unwrap();
        assert!(all.iter().any(|n| n.id == "n1"));
    }
}
