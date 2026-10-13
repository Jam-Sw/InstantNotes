use crate::error::{AppError, Result};
use crate::store::{Store, MIGRATIONS};
use chrono::{DateTime, Datelike, Duration, NaiveDateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const DIR: &str = "backups";
pub const PENDING: &str = "pending-restore.db";
pub const MARKER_SUFFIX: &str = ".restore";
pub const AUTOMATIC_SETTING: &str = "backups.automatic";
const PREFIX: &str = "instantnotes-";
const EXT: &str = ".db";
const BEFORE_RESTORE: &str = "-before-restore";
const STAMP: &str = "%Y%m%d-%H%M%S";
const DAILY_DAYS: i64 = 7;
const WEEKLY_WEEKS: i64 = 5;
const MONTHLY_MONTHS: i64 = 6;

pub fn file_name(at: DateTime<Utc>) -> String {
    format!("{PREFIX}{}{EXT}", at.format(STAMP))
}

pub fn before_restore_name(at: DateTime<Utc>) -> String {
    format!("{PREFIX}{}{BEFORE_RESTORE}{EXT}", at.format(STAMP))
}

pub fn parse_name(name: &str) -> Option<DateTime<Utc>> {
    let rest = name.strip_prefix(PREFIX)?.strip_suffix(EXT)?;
    let (stamp, tail) = rest.split_at_checked(15)?;
    if !tail.is_empty() && tail != BEFORE_RESTORE {
        return None;
    }
    let naive = NaiveDateTime::parse_from_str(stamp, STAMP).ok()?;
    Some(naive.and_utc())
}

pub fn keep(now: DateTime<Utc>, names: &[String]) -> (Vec<String>, Vec<String>) {
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    let mut weekly: BTreeMap<(i32, u32), (DateTime<Utc>, String)> = BTreeMap::new();
    let mut monthly: BTreeMap<(i32, u32), (DateTime<Utc>, String)> = BTreeMap::new();
    let mut candidates: Vec<String> = Vec::new();
    let weekly_end = Duration::days(DAILY_DAYS + WEEKLY_WEEKS * 7);
    let months_of = |at: DateTime<Utc>| at.year() as i64 * 12 + at.month() as i64;
    for name in names {
        let Some(at) = parse_name(name) else { continue };
        let age = now.signed_duration_since(at);
        if age <= Duration::days(DAILY_DAYS) {
            kept.push(name.clone());
            continue;
        }
        candidates.push(name.clone());
        if age <= weekly_end {
            let week = at.iso_week();
            let slot = (week.year(), week.week());
            match weekly.get(&slot) {
                Some((best, _)) if *best >= at => {}
                _ => {
                    weekly.insert(slot, (at, name.clone()));
                }
            }
            continue;
        }
        let months_back = months_of(now) - months_of(at);
        if months_back <= MONTHLY_MONTHS + (WEEKLY_WEEKS * 7 + DAILY_DAYS) / 30 {
            let slot = (at.year(), at.month());
            match monthly.get(&slot) {
                Some((best, _)) if *best >= at => {}
                _ => {
                    monthly.insert(slot, (at, name.clone()));
                }
            }
        }
    }
    let winners: Vec<String> = weekly
        .into_values()
        .chain(monthly.into_values())
        .map(|(_, name)| name)
        .collect();
    for name in candidates {
        if winners.contains(&name) {
            kept.push(name);
        } else {
            dropped.push(name);
        }
    }
    (kept, dropped)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inspection {
    pub made_at: Option<String>,
    pub notes: i64,
    pub schema_version: i64,
}

fn made_at_of(path: &Path) -> Option<String> {
    let from_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(parse_name);
    let at = from_name.or_else(|| {
        std::fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .map(DateTime::<Utc>::from)
    })?;
    Some(at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

pub fn verify_backup(path: &Path) -> Result<Inspection> {
    let refuse = |why: String| AppError::Validation(format!("not an InstantNotes library: {why}"));
    if !path.is_file() {
        return Err(refuse("the file does not exist".into()));
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| refuse(e.to_string()))?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| refuse(e.to_string()))?;
    if check != "ok" {
        return Err(refuse(format!("the integrity check failed ({check})")));
    }
    let schema_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| refuse(e.to_string()))?;
    if schema_version > MIGRATIONS.len() as i64 {
        return Err(AppError::Validation(format!(
            "this backup was made by a newer version of InstantNotes (schema v{schema_version}, this build knows up to v{})",
            MIGRATIONS.len()
        )));
    }
    let has_notes: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| refuse(e.to_string()))?;
    if has_notes == 0 {
        return Err(refuse("it holds no notes table".into()));
    }
    let notes: i64 = conn
        .query_row("SELECT count(*) FROM notes WHERE is_deleted = 0", [], |r| {
            r.get(0)
        })
        .map_err(|e| refuse(e.to_string()))?;
    Ok(Inspection {
        made_at: made_at_of(path),
        notes,
        schema_version,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreOutcome {
    pub restored_from: PathBuf,
    pub made_at: Option<String>,
    pub snapshot: PathBuf,
}

pub fn marker_path(library: &Path) -> PathBuf {
    let mut name = library.as_os_str().to_os_string();
    name.push(MARKER_SUFFIX);
    PathBuf::from(name)
}

fn with_suffix(library: &Path, suffix: &str) -> PathBuf {
    let mut name = library.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)?;
    std::fs::remove_file(from)
}

fn snapshot_current(library: &Path, backups: &Path, now: DateTime<Utc>) -> Result<PathBuf> {
    let snapshot = backups.join(before_restore_name(now));
    std::fs::create_dir_all(backups)
        .map_err(|e| AppError::Storage(format!("cannot create the backups folder: {e}")))?;
    let copied = Store::open_reader(library).and_then(|reader| reader.backup_to(&snapshot));
    if copied.is_ok() {
        return Ok(snapshot);
    }
    let _ = std::fs::remove_file(&snapshot);
    replace_file(library, &snapshot)
        .map_err(|e| AppError::Storage(format!("cannot move the current library aside: {e}")))?;
    for suffix in ["-wal", "-shm"] {
        let aside = with_suffix(&snapshot, suffix);
        let _ = replace_file(&with_suffix(library, suffix), &aside);
    }
    Ok(snapshot)
}

pub fn apply_pending_restore(library: &Path, backups: &Path) -> Result<Option<RestoreOutcome>> {
    let marker = marker_path(library);
    if !marker.exists() {
        return Ok(None);
    }
    let outcome = apply_marked_restore(library, backups, &marker);
    let _ = std::fs::remove_file(&marker);
    outcome.map(Some)
}

fn apply_marked_restore(library: &Path, backups: &Path, marker: &Path) -> Result<RestoreOutcome> {
    let pending = std::fs::read_to_string(marker)
        .map_err(|e| AppError::Storage(format!("cannot read the restore marker: {e}")))?;
    let pending = PathBuf::from(pending.trim());
    let inspection = verify_backup(&pending)?;
    let now = Utc::now();
    let snapshot = if library.exists() {
        snapshot_current(library, backups, now)?
    } else {
        backups.join(before_restore_name(now))
    };
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(with_suffix(library, suffix));
    }
    replace_file(&pending, library)
        .map_err(|e| AppError::Storage(format!("cannot put the backup in place: {e}")))?;
    Ok(RestoreOutcome {
        restored_from: pending,
        made_at: inspection.made_at,
        snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(y: i32, m: u32, d: u32, h: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, 0, 0).unwrap()
    }

    #[test]
    fn names_round_trip_and_odd_names_do_not_parse() {
        let when = at(2026, 10, 13, 7);
        assert_eq!(file_name(when), "instantnotes-20261013-070000.db");
        assert_eq!(parse_name(&file_name(when)), Some(when));
        assert_eq!(parse_name(&before_restore_name(when)), Some(when));
        assert_eq!(parse_name("instantnotes-20261013-070000-x.db"), None);
        assert_eq!(parse_name("instantnotes.db"), None);
        assert_eq!(parse_name("instantnotes-2026101-070000.db"), None);
        assert_eq!(parse_name("notes.txt"), None);
    }

    #[test]
    fn keeps_a_week_of_everything_then_one_per_week_then_one_per_month() {
        let now = at(2026, 10, 13, 12);
        let mut names = Vec::new();
        for day in 0..400 {
            let when = now - Duration::days(day) - Duration::hours(1);
            names.push(file_name(when));
            if day < 10 {
                names.push(file_name(when - Duration::hours(6)));
            }
        }
        names.push("instantnotes.db.backup-v11".to_string());
        names.push("notes.txt".to_string());
        let (kept, dropped) = keep(now, &names);
        let ages = |list: &[String]| -> Vec<i64> {
            list.iter()
                .map(|n| now.signed_duration_since(parse_name(n).unwrap()).num_days())
                .collect()
        };
        let kept_ages = ages(&kept);
        let within_week = kept
            .iter()
            .filter(|n| now.signed_duration_since(parse_name(n).unwrap()) <= Duration::days(7))
            .count();
        assert_eq!(within_week, 2 * 7);
        let weekly: Vec<i64> = kept_ages
            .iter()
            .copied()
            .filter(|a| *a > 7 && *a <= 42)
            .collect();
        assert!(weekly.len() == 5 || weekly.len() == 6, "{weekly:?}");
        let monthly: Vec<i64> = kept_ages.iter().copied().filter(|a| *a > 42).collect();
        assert!(monthly.len() >= 6 && monthly.len() <= 8, "{monthly:?}");
        assert!(monthly.iter().all(|a| *a < 260), "{monthly:?}");
        assert!(dropped.iter().all(|n| parse_name(n).is_some()));
        assert_eq!(kept.len() + dropped.len(), names.len() - 2);
        for name in &kept {
            assert!(!dropped.contains(name));
        }
        let per_week = |list: &[String]| {
            let mut seen = std::collections::HashSet::new();
            for n in list {
                let when = parse_name(n).unwrap();
                let age = now.signed_duration_since(when);
                if age > Duration::days(7) && age <= Duration::days(42) {
                    let w = when.iso_week();
                    assert!(seen.insert((w.year(), w.week())), "two kept in one week");
                }
            }
        };
        per_week(&kept);
    }

    #[test]
    fn a_backup_from_the_future_is_kept() {
        let now = at(2026, 10, 13, 12);
        let name = file_name(now + Duration::days(2));
        let (kept, dropped) = keep(now, std::slice::from_ref(&name));
        assert_eq!(kept, vec![name]);
        assert!(dropped.is_empty());
    }

    fn library_with_notes(dir: &Path, name: &str, notes: usize) -> PathBuf {
        let path = dir.join(name);
        let mut store = Store::open(&path).unwrap();
        for i in 0..notes {
            store
                .create_note(crate::types::CreateNoteInput {
                    title: Some(format!("note {i}")),
                    body: Some("body".into()),
                    tags: Vec::new(),
                })
                .unwrap();
        }
        drop(store);
        path
    }

    #[test]
    fn backup_to_works_on_a_reader_while_a_writer_holds_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("instantnotes.db");
        let mut writer = Store::open(&path).unwrap();
        writer
            .create_note(crate::types::CreateNoteInput {
                title: Some("kept".into()),
                body: Some("in the wal".into()),
                tags: Vec::new(),
            })
            .unwrap();
        let reader = Store::open_reader(&path).unwrap();
        let copy = dir.path().join("copy.db");
        reader.backup_to(&copy).unwrap();
        let inspection = verify_backup(&copy).unwrap();
        assert_eq!(inspection.notes, 1);
        assert_eq!(inspection.schema_version, MIGRATIONS.len() as i64);
        writer
            .create_note(crate::types::CreateNoteInput {
                title: Some("after".into()),
                body: None,
                tags: Vec::new(),
            })
            .unwrap();
        assert_eq!(verify_backup(&copy).unwrap().notes, 1);
    }

    #[test]
    fn verify_refuses_a_text_file_a_newer_schema_and_a_database_without_notes() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("notes.db");
        std::fs::write(&text, "hello").unwrap();
        assert!(matches!(verify_backup(&text), Err(AppError::Validation(_))));

        let newer = library_with_notes(dir.path(), "newer.db", 0);
        let conn = Connection::open(&newer).unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        drop(conn);
        let err = verify_backup(&newer).unwrap_err();
        assert!(err.to_string().contains("newer version"), "{err}");

        let empty = dir.path().join("empty.db");
        let conn = Connection::open(&empty).unwrap();
        conn.execute_batch("CREATE TABLE things (id INTEGER)")
            .unwrap();
        drop(conn);
        let err = verify_backup(&empty).unwrap_err();
        assert!(err.to_string().contains("no notes table"), "{err}");

        assert!(verify_backup(&dir.path().join("missing.db")).is_err());
    }

    #[test]
    fn a_marked_restore_replaces_the_library_and_keeps_the_old_one() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let library = library_with_notes(dir.path(), "instantnotes.db", 3);
        let pending_src = library_with_notes(dir.path(), "older.db", 1);
        std::fs::create_dir_all(&backups).unwrap();
        let pending = backups.join(PENDING);
        std::fs::copy(&pending_src, &pending).unwrap();
        std::fs::write(marker_path(&library), pending.to_string_lossy().as_bytes()).unwrap();

        let outcome = apply_pending_restore(&library, &backups).unwrap().unwrap();

        assert!(!marker_path(&library).exists());
        assert!(!pending.exists());
        assert_eq!(verify_backup(&library).unwrap().notes, 1);
        assert_eq!(verify_backup(&outcome.snapshot).unwrap().notes, 3);
        assert!(outcome
            .snapshot
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with("-before-restore.db"));
        assert_eq!(apply_pending_restore(&library, &backups).unwrap(), None);
    }

    #[test]
    fn a_broken_pending_file_leaves_the_library_alone_and_clears_the_marker() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let library = library_with_notes(dir.path(), "instantnotes.db", 2);
        std::fs::create_dir_all(&backups).unwrap();
        let pending = backups.join(PENDING);
        std::fs::write(&pending, "not a database").unwrap();
        std::fs::write(marker_path(&library), pending.to_string_lossy().as_bytes()).unwrap();

        let err = apply_pending_restore(&library, &backups).unwrap_err();

        assert!(matches!(err, AppError::Validation(_)), "{err}");
        assert!(!marker_path(&library).exists());
        assert_eq!(verify_backup(&library).unwrap().notes, 2);
        assert!(std::fs::read_dir(&backups).unwrap().count() == 1);
    }

    #[test]
    fn detach_sync_forgets_the_folder_the_server_and_the_bases() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("instantnotes.db");
        let vault = dir.path().join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let mut store = Store::open(&path).unwrap();
        store.configure_vault(Some(&vault)).unwrap();
        store
            .set_setting("vault.transport", serde_json::json!("server"))
            .unwrap();
        store
            .set_setting(
                "vault.server",
                serde_json::json!({ "address": "https://example.org" }),
            )
            .unwrap();
        store
            .set_setting("sync.state", serde_json::json!({ "cursor": 5 }))
            .unwrap();

        store.detach_sync().unwrap();

        assert!(store.vault_root().is_none());
        for key in [
            "vault.path",
            "vault.transport",
            "vault.server",
            "sync.state",
        ] {
            assert_eq!(store.get_setting(key).unwrap(), None, "{key}");
        }
        assert_eq!(store.vault_transport().unwrap(), "folder");
    }
}
