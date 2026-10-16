use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const FILE: &str = "instantnotes.log";
pub const ROTATED: &str = "instantnotes.log.1";
pub const LIMIT: u64 = 1024 * 1024;
pub const TAIL_LINES: usize = 40;

static DIR: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn init(dir: &Path) {
    let _ = DIR.set(dir.to_path_buf());
}

pub(crate) fn path() -> Option<PathBuf> {
    DIR.get().map(|d| d.join(FILE))
}

fn clean(value: &str) -> String {
    value
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
}

pub(crate) fn line(now: &str, event: &str, fields: &[(&str, &str)]) -> String {
    let mut out = format!("{now} {event}");
    for (key, value) in fields {
        out.push(' ');
        out.push_str(key);
        out.push('=');
        out.push_str(&clean(value));
    }
    out
}

pub(crate) fn append(path: &Path, text: &str, limit: u64) -> std::io::Result<()> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size >= limit {
        let rotated = path.with_file_name(ROTATED);
        let _ = std::fs::remove_file(&rotated);
        std::fs::rename(path, rotated)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{text}")
}

pub(crate) fn log(event: &str, fields: &[(&str, &str)]) {
    let Some(path) = path() else { return };
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let text = line(&now, event, fields);
    if let Err(e) = append(&path, &text, LIMIT) {
        eprintln!("log write failed: {e}");
    }
}

pub(crate) fn tail(path: &Path, lines: usize) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let all: Vec<&str> = text.lines().collect();
    let from = all.len().saturating_sub(lines);
    all[from..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_the_time_the_event_and_flat_fields() {
        let got = line(
            "2026-10-13T07:00:00Z",
            "backup.made",
            &[("bytes", "2048"), ("error", "disk\nfull")],
        );
        assert_eq!(
            got,
            "2026-10-13T07:00:00Z backup.made bytes=2048 error=disk full"
        );
    }

    #[test]
    fn the_file_rotates_once_at_the_limit_and_keeps_one_old_copy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        append(&path, "one", 10).unwrap();
        append(&path, "two", 10).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\n");
        append(&path, "three", 8).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "three\n");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(ROTATED)).unwrap(),
            "one\ntwo\n"
        );
        append(&path, "four", 6).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "four\n");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(ROTATED)).unwrap(),
            "three\n"
        );
    }

    #[test]
    fn the_tail_is_the_last_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        for i in 0..5 {
            append(&path, &format!("line {i}"), LIMIT).unwrap();
        }
        assert_eq!(tail(&path, 2), "line 3\nline 4");
        assert_eq!(tail(&path, 10), "line 0\nline 1\nline 2\nline 3\nline 4");
        assert_eq!(tail(&dir.path().join("missing"), 2), "");
    }
}
