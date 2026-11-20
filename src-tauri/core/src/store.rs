use crate::domain;
use crate::error::{AppError, Result};
use crate::types::*;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

const ALWAYS_VERIFY_BELOW_BYTES: u64 = 4 * 1024 * 1024;
const VERIFY_EVERY_DAYS: i64 = 7;
const RECORD_REFRESH_DAYS: i64 = 1;
const INTEGRITY_CHECKED_KEY: &str = "integrity.checked_at";
const SUSPECT_SUFFIX: &str = ".verify";
const SESSION_SUFFIX: &str = ".open";
#[cfg(not(target_family = "wasm"))]
const JOURNAL_MODE: &str = "wal";
#[cfg(target_family = "wasm")]
const JOURNAL_MODE: &str = "truncate";

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub struct Store {
    conn: Connection,
    vault: Option<vault::VaultState>,
    suggest_corpus: std::cell::RefCell<corpus::CorpusCache>,
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
        let journal_mode: String =
            conn.query_row(&format!("PRAGMA journal_mode = {JOURNAL_MODE}"), [], |r| {
                r.get(0)
            })?;
        if !journal_mode.eq_ignore_ascii_case(JOURNAL_MODE) {
            return Err(AppError::Storage(format!(
                "storage location does not support {JOURNAL_MODE} journaling (got '{journal_mode}')"
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
        Ok(Store {
            conn,
            vault: None,
            suggest_corpus: Default::default(),
        })
    }

    pub fn backup_to(&self, path: &Path) -> Result<()> {
        let escaped = path.to_string_lossy().replace('\'', "''");
        let query_only: bool = self
            .conn
            .query_row("PRAGMA query_only", [], |r| r.get(0))
            .map_err(|e| AppError::Storage(format!("backup failed: {e}")))?;
        if query_only {
            self.conn.pragma_update(None, "query_only", "OFF")?;
        }
        let copied = self
            .conn
            .execute_batch(&format!("VACUUM INTO '{escaped}'"))
            .map_err(|e| AppError::Storage(format!("backup failed: {e}")));
        if query_only {
            self.conn.pragma_update(None, "query_only", "ON")?;
        }
        copied
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
        let mut store = Store {
            conn,
            vault: None,
            suggest_corpus: Default::default(),
        };
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
mod corpus;
mod fold;
mod graph;
mod import;
mod migrations;
mod notes;
mod related;
mod rows;
pub mod server_sync;
mod settings;
mod stats;
mod suggest;
mod tags;
mod vault;
mod vault_sync;
mod workspaces;

pub use fold::fold_ids;
pub use migrations::MIGRATIONS;
pub use notes::REVISIT_AFTER_MS;
pub use related::{RELATED_DEFAULT_LIMIT, RELATED_SUGGEST_SETTING};
use rows::*;
pub use rows::{iso, now_ms};
pub use settings::{
    is_shared_setting, merge_shared_settings, serialize_shared_settings, SharedSettings,
    SHARED_SETTINGS,
};

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
