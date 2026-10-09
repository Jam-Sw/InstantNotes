use crate::domain;
use crate::error::{AppError, Result};
use crate::types::*;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const ALWAYS_VERIFY_BELOW_BYTES: u64 = 4 * 1024 * 1024;
const VERIFY_EVERY_DAYS: i64 = 7;
const RECORD_REFRESH_DAYS: i64 = 1;
const INTEGRITY_CHECKED_KEY: &str = "integrity.checked_at";
const SUSPECT_SUFFIX: &str = ".verify";
const SESSION_SUFFIX: &str = ".open";

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub const MIGRATIONS: &[&str] = &[
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
    r#"
ALTER TABLE notes DROP COLUMN sync_state;
ALTER TABLE notes DROP COLUMN version;
ALTER TABLE notes DROP COLUMN last_synced_at;
"#,
    r#"
ALTER TABLE notes ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'document';
ALTER TABLE notes ADD COLUMN surface_data TEXT;
"#,
    r#"
ALTER TABLE notes ADD COLUMN vault_path  TEXT;
ALTER TABLE notes ADD COLUMN file_sha    TEXT;
ALTER TABLE notes ADD COLUMN vault_dirty INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notes_vault_dirty ON notes(vault_dirty) WHERE vault_dirty = 1;
CREATE INDEX idx_notes_vault_path ON notes(vault_path COLLATE NOCASE)
  WHERE vault_path IS NOT NULL;

-- A hard-deleted note leaves no row to flag, so its file is queued here.
CREATE TABLE vault_tombstones (
  vault_path TEXT PRIMARY KEY,
  file_sha   TEXT
);

CREATE TRIGGER notes_vault_ai AFTER INSERT ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;
CREATE TRIGGER notes_vault_au AFTER UPDATE OF
  title, title_is_auto, body, created_at, updated_at,
  is_pinned, is_archived, is_deleted, deleted_at ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
END;

-- Edge changes, including the cascades from deleting a tag or a space.
CREATE TRIGGER note_tags_vault_ai AFTER INSERT ON note_tags BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = new.note_id;
END;
CREATE TRIGGER note_tags_vault_ad AFTER DELETE ON note_tags BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = old.note_id;
END;
CREATE TRIGGER note_workspaces_vault_ai AFTER INSERT ON note_workspaces BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = new.note_id;
END;
CREATE TRIGGER note_workspaces_vault_ad AFTER DELETE ON note_workspaces BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE id = old.note_id;
END;

-- Names are what the frontmatter carries; a color change touches only
-- instantnotes.yaml, which the flush compares on its own.
CREATE TRIGGER tags_vault_au AFTER UPDATE OF name ON tags
  WHEN old.name IS NOT new.name BEGIN
  UPDATE notes SET vault_dirty = 1
    WHERE id IN (SELECT note_id FROM note_tags WHERE tag_id = new.id);
END;
CREATE TRIGGER workspaces_vault_au AFTER UPDATE OF name ON workspaces
  WHEN old.name IS NOT new.name BEGIN
  UPDATE notes SET vault_dirty = 1
    WHERE id IN (SELECT note_id FROM note_workspaces WHERE workspace_id = new.id);
END;
"#,
    r#"
ALTER TABLE notes ADD COLUMN board_sha TEXT;

DROP TRIGGER notes_vault_au;
CREATE TRIGGER notes_vault_au AFTER UPDATE OF
  title, title_is_auto, body, created_at, updated_at,
  is_pinned, is_archived, is_deleted, deleted_at,
  content_kind, surface_data ON notes BEGIN
  UPDATE notes SET vault_dirty = 1 WHERE seq = new.seq;
END;

DROP TRIGGER notes_vault_ad;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    SELECT substr(old.vault_path, 1, length(old.vault_path) - 3) || '.excalidraw',
           old.board_sha
    WHERE old.board_sha IS NOT NULL;
END;
"#,
    r#"
CREATE TABLE agent_activity (
  seq              INTEGER PRIMARY KEY,
  at               INTEGER NOT NULL,
  session          TEXT NOT NULL,
  client           TEXT NOT NULL,
  tool             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL,
  error            TEXT,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  note_ids         TEXT NOT NULL DEFAULT '[]',
  note_count       INTEGER NOT NULL DEFAULT 0,
  titles           TEXT NOT NULL DEFAULT '[]',
  space            TEXT,
  tag              TEXT,
  query            TEXT,
  after_updated_at TEXT,
  before           TEXT,
  reverted_at      INTEGER,
  reverts          INTEGER
);
"#,
    r#"
ALTER TABLE agent_activity ADD COLUMN request TEXT;
ALTER TABLE agent_activity ADD COLUMN response TEXT;
"#,
    r#"
CREATE TABLE agent_sessions (
  session         TEXT PRIMARY KEY,
  client          TEXT NOT NULL,
  connected_at    INTEGER NOT NULL,
  disconnected_at INTEGER
);
"#,
    r#"
ALTER TABLE agent_sessions ADD COLUMN label TEXT;
ALTER TABLE agent_sessions ADD COLUMN client_session TEXT;
ALTER TABLE agent_sessions ADD COLUMN cwd TEXT;
ALTER TABLE agent_sessions ADD COLUMN client_pid INTEGER;
"#,
    r#"
ALTER TABLE agent_sessions ADD COLUMN matched TEXT;
"#,
    r#"
DROP TRIGGER notes_vault_ad;
CREATE TRIGGER notes_vault_ad AFTER DELETE ON notes
  WHEN old.vault_path IS NOT NULL BEGIN
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    VALUES (old.vault_path, old.file_sha);
  INSERT OR REPLACE INTO vault_tombstones (vault_path, file_sha)
    SELECT substr(old.vault_path, 1, length(old.vault_path) - 3)
             || CASE old.content_kind WHEN 'sheet' THEN '.csv' ELSE '.excalidraw' END,
           old.board_sha
    WHERE old.board_sha IS NOT NULL;
END;
"#,
    r#"
DROP INDEX idx_notes_flags;
CREATE INDEX idx_notes_list ON notes(is_deleted, is_archived, is_pinned DESC, updated_at DESC, id);
CREATE INDEX idx_notes_revisit ON notes(created_at, id)
  WHERE is_deleted = 0 AND is_archived = 0 AND last_opened_at IS NULL;
"#,
];

const NOTE_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at, content_kind, surface_data";

const LIST_COLUMNS: &str = "id, title, body, created_at, updated_at, last_opened_at, \
     is_pinned, is_archived, is_deleted, deleted_at, content_kind, NULL";

pub struct Store {
    conn: Connection,
    vault: Option<vault::VaultState>,
}

fn now_iso() -> String {
    iso(std::time::SystemTime::now())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

pub fn iso(t: std::time::SystemTime) -> String {
    chrono::DateTime::<Utc>::from(t).to_rfc3339_opts(SecondsFormat::Micros, true)
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
        content_kind: row.get(10)?,
        surface_data: row.get(11)?,
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

fn workspace_get_or_create(conn: &Connection, raw_name: &str) -> Result<Workspace> {
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
        created_at: now.clone(),
        updated_at: now,
    })
}

fn attach_tag(conn: &Connection, note_id: &str, tag_id: &str, source: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at, source) \
         VALUES (?1, ?2, ?3, ?4)",
        params![note_id, tag_id, now_iso(), source],
    )?;
    Ok(())
}

fn fts_match_expr(text: &str) -> Option<String> {
    fts_match_expr_with(text, false)
}

fn fts_match_expr_with(text: &str, any_term: bool) -> Option<String> {
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

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_policy(path, true, ALWAYS_VERIFY_BELOW_BYTES)
    }

    pub fn open_for_agent(path: &Path) -> Result<Self> {
        Self::open_policy(path, false, ALWAYS_VERIFY_BELOW_BYTES)
    }

    pub fn mark_library_suspect(path: &Path) {
        let _ = std::fs::write(sibling(path, SUSPECT_SUFFIX), b"");
    }

    pub fn mark_session_open(path: &Path) {
        let _ = std::fs::write(sibling(path, SESSION_SUFFIX), b"");
    }

    pub fn mark_session_closed(path: &Path) {
        let _ = std::fs::remove_file(sibling(path, SESSION_SUFFIX));
    }

    fn last_integrity_check(conn: &Connection) -> Option<DateTime<Utc>> {
        let raw: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![INTEGRITY_CHECKED_KEY],
                |r| r.get(0),
            )
            .ok()?;
        let stamp: String = serde_json::from_str(&raw).ok()?;
        DateTime::parse_from_rfc3339(&stamp)
            .ok()
            .map(|at| at.with_timezone(&Utc))
    }

    fn needs_integrity_check(
        path: &Path,
        last: Option<DateTime<Utc>>,
        own_session: bool,
        always_below: u64,
    ) -> bool {
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size < always_below
            || sibling(path, SUSPECT_SUFFIX).exists()
            || (own_session && sibling(path, SESSION_SUFFIX).exists())
        {
            return true;
        }
        match last {
            Some(at) => {
                let age = Utc::now().signed_duration_since(at);
                age > Duration::days(VERIFY_EVERY_DAYS) || age < Duration::days(-1)
            }
            None => true,
        }
    }

    fn open_policy(path: &Path, own_session: bool, always_below: u64) -> Result<Self> {
        let conn = Connection::open(path)
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| AppError::Storage(format!("cannot set busy timeout: {e}")))?;
        let journal_mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            return Err(AppError::Storage(format!(
                "storage location does not support WAL journaling (got '{journal_mode}')"
            )));
        }
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| AppError::Storage(format!("cannot set synchronous mode: {e}")))?;
        let last = Self::last_integrity_check(&conn);
        let verify = Self::needs_integrity_check(path, last, own_session, always_below);
        Self::backup_before_migration(path, &conn)?;
        let mut store = Self::init(conn, verify)?;
        if verify {
            let _ = std::fs::remove_file(sibling(path, SUSPECT_SUFFIX));
            let due = last.is_none_or(|at| {
                Utc::now().signed_duration_since(at) > Duration::days(RECORD_REFRESH_DAYS)
            });
            if due {
                let _ =
                    store.set_setting(INTEGRITY_CHECKED_KEY, serde_json::Value::String(now_iso()));
            }
        }
        Ok(store)
    }

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

    pub fn open_reader(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| AppError::Storage(format!("cannot set busy timeout: {e}")))?;
        conn.pragma_update(None, "query_only", "ON")
            .map_err(|e| AppError::Storage(format!("cannot set read-only mode: {e}")))?;
        Ok(Store { conn, vault: None })
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()
            .map_err(|e| AppError::Storage(format!("cannot open database: {e}")))?;
        Self::init(conn, true)
    }

    fn init(mut conn: Connection, verify: bool) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.set_transaction_behavior(rusqlite::TransactionBehavior::Immediate);
        if verify {
            let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
            if check != "ok" {
                return Err(AppError::Corruption(format!(
                    "database integrity check failed: {check}"
                )));
            }
        }
        let mut store = Store { conn, vault: None };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let current: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current > MIGRATIONS.len() as i64 {
            return Err(AppError::SchemaTooNew {
                found: current,
                known: MIGRATIONS.len(),
            });
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

    fn backup_before_migration(path: &Path, conn: &Connection) -> Result<()> {
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current <= 0 || current >= MIGRATIONS.len() as i64 {
            return Ok(());
        }
        let mut backup = path.as_os_str().to_os_string();
        backup.push(format!(".backup-v{current}"));
        let backup_path = PathBuf::from(backup);
        if backup_path.exists() {
            std::fs::remove_file(&backup_path)
                .map_err(|e| AppError::Storage(format!("cannot clear stale backup: {e}")))?;
        }
        let escaped = backup_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{escaped}'"))
            .map_err(|e| match AppError::from(e) {
                AppError::Corruption(msg) => {
                    AppError::Corruption(format!("pre-migration backup failed: {msg}"))
                }
                other => AppError::Storage(format!("pre-migration backup failed: {other}")),
            })?;
        Ok(())
    }

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

    pub fn data_version(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("PRAGMA data_version", [], |r| r.get(0))?)
    }

    pub fn schema_is_current(&self) -> Result<bool> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        Ok(version == MIGRATIONS.len() as i64)
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

pub mod activity;
mod attachments;
mod graph;
mod import;
mod notes;
mod settings;
mod stats;
mod suggest;
mod tags;
mod vault;
mod workspaces;

pub use notes::REVISIT_AFTER_MS;

#[cfg(test)]
mod pragma_tests {
    use super::Store;
    use tempfile::tempdir;

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

        let synchronous: i64 = store
            .conn
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .unwrap();
        assert_eq!(synchronous, 1);
    }
}

#[cfg(test)]
mod integrity_tests {
    use super::*;
    use tempfile::tempdir;

    fn library(path: &Path) {
        let mut s = Store::open_policy(path, true, 0).unwrap();
        for i in 0..400 {
            s.create_note(CreateNoteInput {
                body: Some(format!("note {i} {}", "filler ".repeat(40))),
                ..Default::default()
            })
            .unwrap();
        }
    }

    fn damage(path: &Path) {
        let mut bytes = std::fs::read(path).unwrap();
        let from = bytes.len() / 2;
        for b in &mut bytes[from..from + 8192] {
            *b = 0x5A;
        }
        std::fs::write(path, bytes).unwrap();
    }

    fn backdate_record(path: &Path, days: i64) {
        let at = (Utc::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Millis, true);
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "UPDATE settings SET value = ?1 WHERE key = ?2",
            params![serde_json::to_string(&at).unwrap(), INTEGRITY_CHECKED_KEY],
        )
        .unwrap();
    }

    fn is_corruption(result: Result<Store>) -> bool {
        matches!(result, Err(e) if e.is_corruption())
    }

    #[test]
    fn a_recent_check_lets_a_large_library_open_without_scanning() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        damage(&path);
        assert!(Store::open_policy(&path, true, 0).is_ok());
    }

    #[test]
    fn a_small_library_is_always_scanned() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        damage(&path);
        assert!(is_corruption(Store::open_policy(&path, true, u64::MAX)));
    }

    #[test]
    fn a_suspect_marker_forces_the_scan() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        damage(&path);
        Store::mark_library_suspect(&path);
        assert!(is_corruption(Store::open_policy(&path, true, 0)));
        assert!(is_corruption(Store::open_policy(&path, false, 0)));
    }

    #[test]
    fn an_unclean_session_forces_the_scan_for_the_app_only() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        damage(&path);
        Store::mark_session_open(&path);
        assert!(is_corruption(Store::open_policy(&path, true, 0)));
        assert!(Store::open_policy(&path, false, 0).is_ok());
        Store::mark_session_closed(&path);
        assert!(Store::open_policy(&path, true, 0).is_ok());
    }

    #[test]
    fn a_week_old_record_forces_the_scan() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        backdate_record(&path, VERIFY_EVERY_DAYS + 1);
        damage(&path);
        assert!(is_corruption(Store::open_policy(&path, true, 0)));
    }

    #[test]
    fn a_record_from_the_future_forces_the_scan() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        backdate_record(&path, -3);
        damage(&path);
        assert!(is_corruption(Store::open_policy(&path, true, 0)));
    }

    #[test]
    fn a_passed_scan_clears_the_suspect_marker_and_records_the_time() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.db");
        library(&path);
        backdate_record(&path, VERIFY_EVERY_DAYS + 1);
        Store::mark_library_suspect(&path);
        let store = Store::open_policy(&path, true, 0).unwrap();
        assert!(!sibling(&path, SUSPECT_SUFFIX).exists());
        let stamp = store.get_setting(INTEGRITY_CHECKED_KEY).unwrap().unwrap();
        let at = DateTime::parse_from_rfc3339(stamp.as_str().unwrap()).unwrap();
        assert!(Utc::now().signed_duration_since(at) < Duration::minutes(1));
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

    #[test]
    fn v3_drops_sync_columns_and_preserves_notes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.db");

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

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        assert!(!cols.contains(&"sync_state".to_string()));
        assert!(!cols.contains(&"version".to_string()));
        assert!(!cols.contains(&"last_synced_at".to_string()));

        let note = store.get_note("n1", false).unwrap();
        assert_eq!(note.title, "Kept");
        assert_eq!(note.body, "the body");
        let all = store.list_notes(Default::default()).unwrap();
        assert!(all.iter().any(|n| n.id == "n1"));
    }

    #[test]
    fn a_whiteboard_v4_library_migrates_to_the_vault_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("whiteboard.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
            }
            conn.execute_batch(
                "ALTER TABLE notes ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'document';
                 ALTER TABLE notes ADD COLUMN surface_data TEXT;",
            )
            .unwrap();
            conn.pragma_update(None, "user_version", 4i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at, content_kind) \
                 VALUES ('n1', 'Board', 'the body', 't', 't', 'whiteboard')",
                [],
            )
            .unwrap();
        }

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        for col in ["content_kind", "surface_data", "vault_path", "vault_dirty"] {
            assert!(cols.contains(&col.to_string()), "missing {col}");
        }
        let kind: String = store
            .conn
            .query_row("SELECT content_kind FROM notes WHERE id = 'n1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kind, "whiteboard");
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }

    #[test]
    fn v6_tracks_whiteboard_canvases_in_the_vault() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v5.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..5] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 5i64).unwrap();
        }

        let store = Store::open(&path).unwrap();
        assert!(note_columns(&store.conn).contains(&"board_sha".to_string()));
        store
            .conn
            .execute_batch(
                "INSERT INTO notes (id, title, body, created_at, updated_at, vault_path, \
                 file_sha, board_sha) VALUES ('n1', 'B', '', 't', 't', 'B.md', 'a', 'b');
                 DELETE FROM notes WHERE id = 'n1';",
            )
            .unwrap();
        let mut stmt = store
            .conn
            .prepare("SELECT vault_path, file_sha FROM vault_tombstones ORDER BY vault_path")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("B.excalidraw".to_string(), "b".to_string()),
                ("B.md".to_string(), "a".to_string()),
            ]
        );
    }

    #[test]
    fn v12_tombstones_a_sheet_csv_beside_a_board_canvas() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v11.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..11] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 11i64).unwrap();
        }

        let store = Store::open(&path).unwrap();
        store
            .conn
            .execute_batch(
                "INSERT INTO notes (id, title, body, created_at, updated_at, content_kind, \
                 vault_path, file_sha, board_sha) VALUES \
                 ('b1', 'B', '', 't', 't', 'whiteboard', 'B.md', 'a', 'b'), \
                 ('s1', 'S', '', 't', 't', 'sheet', 'S.md', 'c', 'd');
                 DELETE FROM notes WHERE id IN ('b1', 's1');",
            )
            .unwrap();
        let mut stmt = store
            .conn
            .prepare("SELECT vault_path, file_sha FROM vault_tombstones ORDER BY vault_path")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("B.excalidraw".to_string(), "b".to_string()),
                ("B.md".to_string(), "a".to_string()),
                ("S.csv".to_string(), "d".to_string()),
                ("S.md".to_string(), "c".to_string()),
            ]
        );
    }

    fn index_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA index_list('notes')").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn plan(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>()
            .join(" | ")
    }

    #[test]
    fn v13_swaps_the_flags_index_for_the_list_and_revisit_indexes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v12.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..12] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 12i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't')",
                [],
            )
            .unwrap();
            assert!(index_names(&conn).contains(&"idx_notes_flags".to_string()));
        }

        let mut store = Store::open(&path).unwrap();
        let indexes = index_names(&store.conn);
        assert!(!indexes.contains(&"idx_notes_flags".to_string()));
        assert!(indexes.contains(&"idx_notes_list".to_string()));
        assert!(indexes.contains(&"idx_notes_revisit".to_string()));
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }

    #[test]
    fn the_default_list_reads_in_index_order_without_sorting() {
        let store = Store::open_in_memory().unwrap();
        let listed = plan(
            &store.conn,
            "SELECT id FROM notes WHERE is_deleted = 0 AND is_archived = 0 \
             ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 500",
        );
        assert!(listed.contains("idx_notes_list"), "{listed}");
        assert!(!listed.contains("TEMP B-TREE"), "{listed}");
    }

    #[test]
    fn the_revisit_filter_can_use_its_own_index() {
        let store = Store::open_in_memory().unwrap();
        let counted = plan(
            &store.conn,
            "SELECT COUNT(*) FROM notes INDEXED BY idx_notes_revisit \
             WHERE is_deleted = 0 AND is_archived = 0 AND last_opened_at IS NULL \
             AND created_at < 'z'",
        );
        assert!(counted.contains("idx_notes_revisit"), "{counted}");
    }

    #[test]
    fn v3_library_gains_vault_columns_and_preserves_notes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("v3.db");
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..3] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 3i64).unwrap();
            conn.execute(
                "INSERT INTO notes (id, title, body, created_at, updated_at) \
                 VALUES ('n1', 'Kept', 'the body', 't', 't')",
                [],
            )
            .unwrap();
        }

        let mut store = Store::open(&path).unwrap();

        let cols = note_columns(&store.conn);
        for col in ["vault_path", "file_sha", "vault_dirty"] {
            assert!(cols.contains(&col.to_string()), "missing {col}");
        }
        let dirty: i64 = store
            .conn
            .query_row("SELECT vault_dirty FROM notes WHERE id = 'n1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dirty, 0);
        assert_eq!(store.get_note("n1", false).unwrap().body, "the body");
    }
}
