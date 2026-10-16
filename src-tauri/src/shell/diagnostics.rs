use crate::shell::backups::backups_dir;
use crate::shell::log;
use crate::*;
use instantnotes_core::backup;
use instantnotes_core::store::MIGRATIONS;
use std::path::{Path, PathBuf};

pub const DIR: &str = "crashes";
const STAMP: &str = "%Y%m%d-%H%M%S";

fn stamp() -> String {
    chrono::Utc::now().format(STAMP).to_string()
}

pub(crate) fn crashes_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIR)
}

fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| CmdError::storage(format!("no app data dir: {e}")))
}

fn write_report(dir: &Path, name: &str, text: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(name);
    std::fs::write(&path, text)?;
    Ok(path)
}

pub(crate) fn panic_report(
    version: &str,
    info: &std::panic::PanicHookInfo<'_>,
    thread: &str,
) -> String {
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "panic with no message".to_string());
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "InstantNotes {version} ({} {})\nKind: panic\nThread: {thread}\nLocation: {location}\nMessage: {message}\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

pub(crate) fn install_panic_hook(data_dir: &Path, version: &str) {
    let dir = crashes_dir(data_dir);
    let version = version.to_string();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();
        let text = panic_report(&version, info, &thread);
        let name = format!("crash-{}.txt", stamp());
        let _ = write_report(&dir, &name, &text);
        log::log(
            "crash",
            &[
                ("report", &name),
                ("thread", &thread),
                (
                    "location",
                    &info.location().map(|l| l.to_string()).unwrap_or_default(),
                ),
            ],
        );
        previous(info);
    }));
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub name: String,
    pub made_at: String,
    pub bytes: u64,
}

pub(crate) fn list_reports(dir: &Path) -> Vec<CrashReport> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<CrashReport> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !valid_name(&name) {
                return None;
            }
            let meta = e.metadata().ok()?;
            let made_at = chrono::DateTime::<chrono::Utc>::from(meta.modified().ok()?)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            Some(CrashReport {
                name,
                made_at,
                bytes: meta.len(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

fn valid_name(name: &str) -> bool {
    let stem = name.strip_suffix(".txt").and_then(|s| {
        s.strip_prefix("crash-")
            .or_else(|| s.strip_prefix("error-"))
    });
    stem.is_some_and(|s| s.len() == 15 && s.chars().all(|c| c.is_ascii_digit() || c == '-'))
}

#[tauri::command(async)]
pub fn report_frontend_error(
    app: AppHandle,
    message: String,
    stack: Option<String>,
    r#where: String,
) -> CmdResult<()> {
    let dir = crashes_dir(&data_dir(&app)?);
    let name = format!("error-{}.txt", stamp());
    let text = format!(
        "InstantNotes {} ({} {})\nKind: front-end {}\nMessage: {}\nStack:\n{}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        r#where,
        message.trim(),
        stack.unwrap_or_default().trim()
    );
    write_report(&dir, &name, &text)
        .map_err(|e| CmdError::storage(format!("cannot write the report: {e}")))?;
    log::log(
        "frontend.error",
        &[
            ("report", &name),
            ("where", &r#where),
            ("message", &message),
        ],
    );
    Ok(())
}

#[tauri::command(async)]
pub fn list_crash_reports(app: AppHandle) -> CmdResult<Vec<CrashReport>> {
    Ok(list_reports(&crashes_dir(&data_dir(&app)?)))
}

fn report_path(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    if !valid_name(name) {
        return Err(CmdError::validation("not a crash report name"));
    }
    Ok(crashes_dir(&data_dir(app)?).join(name))
}

#[tauri::command(async)]
pub fn read_crash_report(app: AppHandle, name: String) -> CmdResult<String> {
    std::fs::read_to_string(report_path(&app, &name)?)
        .map_err(|e| CmdError::storage(format!("cannot read the report: {e}")))
}

#[tauri::command(async)]
pub fn delete_crash_report(app: AppHandle, name: String) -> CmdResult<()> {
    std::fs::remove_file(report_path(&app, &name)?)
        .map_err(|e| CmdError::storage(format!("cannot delete the report: {e}")))
}

fn ago(iso: &str) -> String {
    let Ok(at) = chrono::DateTime::parse_from_rfc3339(iso) else {
        return iso.to_string();
    };
    let gap = chrono::Utc::now().signed_duration_since(at.with_timezone(&chrono::Utc));
    let minutes = gap.num_minutes();
    if minutes < 1 {
        "just now".to_string()
    } else if minutes < 60 {
        format!("{minutes} min ago")
    } else if minutes < 60 * 48 {
        format!("{} h ago", minutes / 60)
    } else {
        format!("{} days ago", minutes / (60 * 24))
    }
}

fn day(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|at| at.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn minute(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| iso.to_string())
}

#[tauri::command(async)]
pub fn diagnostics_report(app: AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let data = data_dir(&app)?;
    let (stats, integrity, sync, automatic) = {
        let store = locked(&state)?;
        let stats = store.library_stats()?;
        let integrity = store
            .get_setting("integrity.checked_at")?
            .and_then(|v| v.as_str().map(day));
        let sync = sync_line(&store);
        let automatic = store
            .get_setting(backup::AUTOMATIC_SETTING)?
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        (stats, integrity, sync, automatic)
    };
    let (images, _) = attachments_stats(&app);
    let backups: Vec<(chrono::DateTime<chrono::Utc>, String)> = LIBRARY_DB
        .get()
        .map(|library| backups_dir(library))
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .map(|read| {
            read.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    backup::parse_name(&name).map(|at| (at, name))
                })
                .collect()
        })
        .unwrap_or_default();
    let newest = backups.iter().map(|(at, _)| *at).max();
    let reports = list_reports(&crashes_dir(&data));
    let log_tail = log::path()
        .map(|p| log::tail(&p, log::TAIL_LINES))
        .unwrap_or_default();
    Ok(format_report(&Report {
        version: env!("CARGO_PKG_VERSION"),
        platform: &format!(
            "desktop, {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
        stats: &stats,
        images,
        integrity: integrity.as_deref(),
        sync: &sync,
        backups: backups.len(),
        newest_backup: newest
            .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
            .as_deref()
            .map(minute),
        automatic,
        reports: &reports,
        log_tail: &log_tail,
    }))
}

fn sync_line(store: &Store) -> String {
    let transport = store.vault_transport().unwrap_or_else(|_| "folder".into());
    if transport == "server" {
        let mode = server_settings(store)
            .and_then(|s| s.mode)
            .unwrap_or_else(|| "unknown mode".into());
        let last = store
            .vault_status()
            .ok()
            .and_then(|s| s.last_synced_at)
            .map(|at| format!(", last synced {}", ago(&at)))
            .unwrap_or_default();
        return format!("server, {mode}{last}");
    }
    match store.vault_status() {
        Ok(status) if status.path.is_some() => format!(
            "folder, {}{}, {} conflicts",
            if status.reachable {
                "reachable"
            } else {
                "unreachable"
            },
            status
                .last_synced_at
                .map(|at| format!(", last synced {}", ago(&at)))
                .unwrap_or_default(),
            status.conflicts
        ),
        _ => "off".to_string(),
    }
}

pub(crate) struct Report<'a> {
    pub version: &'a str,
    pub platform: &'a str,
    pub stats: &'a LibraryStats,
    pub images: i64,
    pub integrity: Option<&'a str>,
    pub sync: &'a str,
    pub backups: usize,
    pub newest_backup: Option<String>,
    pub automatic: bool,
    pub reports: &'a [CrashReport],
    pub log_tail: &'a str,
}

pub(crate) fn format_report(r: &Report<'_>) -> String {
    let mut out = format!("InstantNotes {} ({})\n", r.version, r.platform);
    out.push_str(&format!(
        "Library: {} notes ({} archived, {} in Trash), {} tags, {} Spaces, {} images\n",
        r.stats.notes_total,
        r.stats.notes_archived,
        r.stats.notes_trashed,
        r.stats.tags,
        r.stats.spaces,
        r.images
    ));
    out.push_str(&format!(
        "Schema: v{}; last integrity check {}\n",
        MIGRATIONS.len(),
        r.integrity.unwrap_or("never")
    ));
    out.push_str(&format!("Sync: {}\n", r.sync));
    out.push_str(&format!(
        "Backups: {}{} (automatic {})\n",
        r.backups,
        r.newest_backup
            .as_deref()
            .map(|at| format!(", newest {at}"))
            .unwrap_or_default(),
        if r.automatic { "on" } else { "off" }
    ));
    let names: Vec<&str> = r.reports.iter().map(|c| c.name.as_str()).collect();
    out.push_str(&format!(
        "Crash reports: {}{}\n",
        r.reports.len(),
        if names.is_empty() {
            String::new()
        } else {
            format!(" ({})", names.join(", "))
        }
    ));
    out.push_str(&format!("Log (last {} lines):\n", log::TAIL_LINES));
    out.push_str(r.log_tail);
    if !r.log_tail.is_empty() {
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hook_writes_a_report_with_the_message_and_location() {
        let dir = tempfile::tempdir().unwrap();
        let crashes = crashes_dir(dir.path());
        let hook_dir = crashes.clone();
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let text = panic_report("9.9.9", info, "tester");
            let _ = write_report(&hook_dir, "crash-20261013-070000.txt", &text);
        }));
        let outcome = std::panic::catch_unwind(|| {
            panic!("boom {}", 42);
        });
        std::panic::set_hook(previous);
        assert!(outcome.is_err());
        let text = std::fs::read_to_string(crashes.join("crash-20261013-070000.txt")).unwrap();
        assert!(text.starts_with("InstantNotes 9.9.9 ("), "{text}");
        assert!(text.contains("Message: boom 42"), "{text}");
        assert!(
            text.replace('\\', "/")
                .contains("Location: src/shell/diagnostics.rs:"),
            "{text}"
        );
        assert!(text.contains("Thread: tester"), "{text}");
    }

    #[test]
    fn reports_list_newest_first_and_only_their_own_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "crash-20261012-231402.txt",
            "error-20261013-080000.txt",
            "crash-20261013-070000.txt",
            "notes.txt",
            "crash-latest.txt",
        ] {
            std::fs::write(dir.path().join(name), "x").unwrap();
        }
        let names: Vec<String> = list_reports(dir.path())
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(
            names,
            vec![
                "error-20261013-080000.txt",
                "crash-20261013-070000.txt",
                "crash-20261012-231402.txt"
            ]
        );
        assert!(list_reports(&dir.path().join("missing")).is_empty());
    }

    #[test]
    fn the_report_names_what_it_holds_and_nothing_else() {
        let stats = LibraryStats {
            notes_total: 1204,
            notes_active: 1189,
            notes_pinned: 4,
            notes_archived: 3,
            notes_trashed: 12,
            tags: 41,
            spaces: 9,
        };
        let reports = vec![CrashReport {
            name: "crash-20261012-231402.txt".into(),
            made_at: "2026-10-12T23:14:02Z".into(),
            bytes: 10,
        }];
        let text = format_report(&Report {
            version: "0.10.1",
            platform: "desktop, linux x86_64",
            stats: &stats,
            images: 86,
            integrity: Some("2026-10-11"),
            sync: "server, encrypted, last synced 4 min ago",
            backups: 7,
            newest_backup: Some("2026-10-13 06:00".into()),
            automatic: true,
            reports: &reports,
            log_tail: "2026-10-13T06:00:00Z backup.made bytes=2048",
        });
        assert_eq!(
            text,
            "InstantNotes 0.10.1 (desktop, linux x86_64)\n\
             Library: 1204 notes (3 archived, 12 in Trash), 41 tags, 9 Spaces, 86 images\n\
             Schema: v15; last integrity check 2026-10-11\n\
             Sync: server, encrypted, last synced 4 min ago\n\
             Backups: 7, newest 2026-10-13 06:00 (automatic on)\n\
             Crash reports: 1 (crash-20261012-231402.txt)\n\
             Log (last 40 lines):\n\
             2026-10-13T06:00:00Z backup.made bytes=2048\n"
                .replace("v15", &format!("v{}", MIGRATIONS.len()))
        );
    }
}
