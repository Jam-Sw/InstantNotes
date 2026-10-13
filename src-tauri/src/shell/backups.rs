use crate::*;
use chrono::{DateTime, Utc};
use instantnotes_core::backup;
use std::path::{Path, PathBuf};
use std::time::Duration;

const FIRST_WAIT: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(60 * 60);
const FRESH: chrono::Duration = chrono::Duration::hours(24);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub made_at: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupList {
    pub backups: Vec<BackupEntry>,
    pub automatic: bool,
    pub last_at: Option<String>,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    pub made_at: Option<String>,
    pub notes: i64,
    pub schema_version: i64,
}

pub(crate) fn backups_dir(library: &Path) -> PathBuf {
    library
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
        .join(backup::DIR)
}

fn library_path() -> CmdResult<&'static Path> {
    LIBRARY_DB
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| CmdError::storage("the library is not open"))
}

fn entries(dir: &Path) -> Vec<(DateTime<Utc>, BackupEntry)> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(DateTime<Utc>, BackupEntry)> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let at = backup::parse_name(&name)?;
            let bytes = e.metadata().ok()?.len();
            Some((
                at,
                BackupEntry {
                    path: e.path().to_string_lossy().into_owned(),
                    made_at: at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                    bytes,
                },
            ))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

fn automatic(store: &Store) -> bool {
    store
        .get_setting(backup::AUTOMATIC_SETTING)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn list(app: &AppHandle) -> CmdResult<BackupList> {
    let library = library_path()?;
    let dir = backups_dir(library);
    let found = entries(&dir);
    let state = app.state::<AppState>();
    let automatic = automatic(&*locked(&state)?);
    Ok(BackupList {
        last_at: found.first().map(|(_, e)| e.made_at.clone()),
        backups: found.into_iter().map(|(_, e)| e).collect(),
        automatic,
        folder: dir.to_string_lossy().into_owned(),
    })
}

fn prune(dir: &Path) {
    let names: Vec<String> = entries(dir)
        .into_iter()
        .filter_map(|(_, e)| {
            Path::new(&e.path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        })
        .collect();
    let (_, dropped) = backup::keep(Utc::now(), &names);
    for name in dropped {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

fn take_backup(app: &AppHandle) -> CmdResult<()> {
    let library = library_path()?;
    let dir = backups_dir(library);
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("cannot create the backups folder: {e}")))?;
    let target = dir.join(backup::file_name(Utc::now()));
    if target.exists() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    locked_reader(&state)?.backup_to(&target)?;
    prune(&dir);
    let _ = app.emit(events::BACKUPS_CHANGED, ());
    Ok(())
}

fn backup_if_stale(app: &AppHandle) {
    let Ok(library) = library_path() else { return };
    let dir = backups_dir(library);
    let state = app.state::<AppState>();
    let on = match locked(&state) {
        Ok(store) => automatic(&store),
        Err(_) => return,
    };
    if !on {
        return;
    }
    let fresh = entries(&dir)
        .first()
        .is_some_and(|(at, _)| Utc::now().signed_duration_since(*at) < FRESH);
    if fresh {
        return;
    }
    if let Err(e) = take_backup(app) {
        eprintln!("automatic backup failed: {}", e.message());
    }
}

pub(crate) fn start_backups(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_WAIT);
        loop {
            backup_if_stale(&handle);
            std::thread::sleep(EVERY);
        }
    });
}

#[tauri::command(async)]
pub fn list_backups(app: AppHandle) -> CmdResult<BackupList> {
    list(&app)
}

#[tauri::command(async)]
pub fn backup_now(app: AppHandle) -> CmdResult<BackupList> {
    take_backup(&app)?;
    list(&app)
}

#[tauri::command(async)]
pub fn set_backups_automatic(
    app: AppHandle,
    state: State<'_, AppState>,
    on: bool,
) -> CmdResult<()> {
    locked(&state)?.set_setting(backup::AUTOMATIC_SETTING, serde_json::Value::Bool(on))?;
    let _ = app.emit(events::BACKUPS_CHANGED, ());
    Ok(())
}

#[tauri::command(async)]
pub fn inspect_backup(path: String) -> CmdResult<BackupInspection> {
    let found = backup::verify_backup(Path::new(&path))?;
    Ok(BackupInspection {
        made_at: found.made_at,
        notes: found.notes,
        schema_version: found.schema_version,
    })
}

#[tauri::command(async)]
pub fn restore_backup(app: AppHandle, path: String) -> CmdResult<()> {
    let library = library_path()?;
    let source = Path::new(&path);
    backup::verify_backup(source)?;
    let dir = backups_dir(library);
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("cannot create the backups folder: {e}")))?;
    let pending = dir.join(backup::PENDING);
    std::fs::copy(source, &pending)
        .map_err(|e| CmdError::storage(format!("cannot copy the backup: {e}")))?;
    std::fs::write(
        backup::marker_path(library),
        pending.to_string_lossy().as_bytes(),
    )
    .map_err(|e| CmdError::storage(format!("cannot mark the restore: {e}")))?;
    restart_app(app);
    Ok(())
}

#[tauri::command]
pub fn open_backups_folder(app: AppHandle) -> CmdResult<()> {
    let dir = backups_dir(library_path()?);
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("cannot create the backups folder: {e}")))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| CmdError::storage(format!("cannot open the backups folder: {e}")))
}

pub(crate) enum Restored {
    Done(String),
    Failed(String),
}

pub(crate) fn apply_restore_at_launch(library: &Path) -> Option<Restored> {
    match backup::apply_pending_restore(library, &backups_dir(library)) {
        Ok(None) => None,
        Ok(Some(outcome)) => Some(Restored::Done(
            outcome
                .made_at
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|at| {
                    at.with_timezone(&chrono::Local)
                        .format("%-d %B %Y, %H:%M")
                        .to_string()
                })
                .unwrap_or_else(|| "the chosen file".to_string()),
        )),
        Err(e) => Some(Restored::Failed(e.to_string())),
    }
}

pub(crate) fn finish_restore(store: &mut Store) {
    if let Some(settings) = server_settings(store) {
        keychain_delete(&settings, "token");
        keychain_delete(&settings, "key");
    }
    if let Err(e) = store.detach_sync() {
        eprintln!("sync could not be detached after the restore: {e}");
    }
}

pub(crate) fn announce_restore(app: &AppHandle, restored: Restored) {
    let (title, message, kind) = match restored {
        Restored::Done(when) => (
            "Library restored",
            format!(
                "Restored the library from {when}. Sync is off; turn it back on in Settings > Sync when ready."
            ),
            MessageDialogKind::Info,
        ),
        Restored::Failed(why) => (
            "Restore did not happen",
            format!("Your current library is untouched. {why}"),
            MessageDialogKind::Error,
        ),
    };
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_backups_folder_sits_beside_the_library() {
        assert_eq!(
            backups_dir(Path::new("/data/app/instantnotes.db")),
            PathBuf::from("/data/app/backups")
        );
    }

    #[test]
    fn entries_come_newest_first_and_skip_other_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "instantnotes-20260101-120000.db",
            "instantnotes-20260301-120000.db",
            "instantnotes-20260201-120000-before-restore.db",
            "pending-restore.db",
            "notes.txt",
        ] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let got: Vec<String> = entries(dir.path())
            .into_iter()
            .map(|(_, e)| e.made_at)
            .collect();
        assert_eq!(
            got,
            vec![
                "2026-03-01T12:00:00Z",
                "2026-02-01T12:00:00Z",
                "2026-01-01T12:00:00Z"
            ]
        );
    }
}
