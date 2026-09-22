//! Attachment cleanup (SEQUENCE.md unit 11). Pasted and copied-in images live
//! as files under `<app data>/attachments`, and notes reference them as
//! `attachments/<name>`. Destroying the last note that references a file
//! should remove it, so the folder stops growing forever.
//!
//! This module is the careful half: finding references in text, and removing
//! one named file (plus the live vault's copy of it, only while that copy is
//! still identical). Which names are still referenced is a store question
//! (`store/attachments.rs`); when to ask it is the shell's.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

const PREFIX: &str = "attachments/";

fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
}

/// Every attachment name referenced in `text`, as `attachments/<name>`. Wider
/// than the Markdown image syntax on purpose (HTML `src`, a link, a mention
/// in prose): a false match only keeps a file, a missed one would lose it.
pub fn referenced_names(text: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut rest = text;
    while let Some(at) = rest.find(PREFIX) {
        rest = &rest[at + PREFIX.len()..];
        let len = rest.find(|c: char| !is_name_char(c)).unwrap_or(rest.len());
        let name = &rest[..len];
        if !name.is_empty() && name.chars().any(|c| c != '.') {
            found.insert(name.to_string());
        }
    }
    found
}

/// A bare file name: never a path, never `.` or `..`.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(is_name_char) && name.chars().any(|c| c != '.')
}

/// Remove `dir/name`, and `vault_dir/name` too when it holds the same bytes
/// (a copy that differs was changed outside the app and is left alone).
/// Returns the bytes freed in `dir`; a file already gone frees nothing.
pub fn remove_attachment(dir: &Path, vault_dir: Option<&Path>, name: &str) -> io::Result<u64> {
    if !is_plain_name(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("not an attachment name: {name:?}"),
        ));
    }
    let path = dir.join(name);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    if let Some(vault_dir) = vault_dir {
        let copy = vault_dir.join(name);
        if fs::read(&copy).is_ok_and(|theirs| theirs == bytes) {
            fs::remove_file(&copy)?;
        }
    }
    fs::remove_file(&path)?;
    Ok(bytes.len() as u64)
}

/// The files directly in `dir` as `(name, size)`, skipping folders and
/// hidden files. With `modified_before`, only files last changed before
/// then: a fresh paste may belong to an edit that has not saved yet.
pub fn list_attachments(
    dir: &Path,
    modified_before: Option<SystemTime>,
) -> io::Result<Vec<(String, u64)>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata()?;
        if name.starts_with('.') || !meta.is_file() || !is_plain_name(&name) {
            continue;
        }
        if let Some(cutoff) = modified_before {
            if meta.modified()? >= cutoff {
                continue;
            }
        }
        out.push((name, meta.len()));
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_stops_at_the_first_character_a_name_cannot_hold() {
        let found =
            referenced_names("(attachments/a.png) \"attachments/b.gif\" attachments/c.jpg?x");
        assert_eq!(
            found.into_iter().collect::<Vec<_>>(),
            vec!["a.png", "b.gif", "c.jpg"]
        );
    }

    #[test]
    fn dots_alone_are_not_a_name() {
        assert!(referenced_names("attachments/.. attachments/.").is_empty());
    }
}
