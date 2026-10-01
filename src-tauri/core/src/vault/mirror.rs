//! Stage 2 mirror types. The flush itself lives on `Store`
//! (`store/vault.rs`), which owns the connection.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub struct FlushOutcome {
    pub written: usize,
    pub removed: usize,
    pub remaining: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub path: Option<String>,
    pub pending: i64,
    pub last_error: Option<String>,
    pub last_flushed_at: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReport {
    pub checked: usize,
    pub missing: Vec<String>,
    pub diverged: Vec<String>,
    pub orphans: Vec<String>,
    pub pending: i64,
    pub manifest_ok: bool,
}

/// Whether `path` is `dir` itself or somewhere inside it. Both are resolved
/// first (symlinks, `..`, and on macOS `/var` vs `/private/var`), so two
/// spellings of one folder compare equal. A path that does not exist yet is
/// resolved through its nearest existing ancestor.
pub fn is_within(path: &Path, dir: &Path) -> bool {
    // Path::starts_with compares whole components, so `notes2` is not
    // inside `notes`.
    resolve(path).starts_with(resolve(dir))
}

fn resolve(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut current = path;
    loop {
        if let Ok(real) = current.canonicalize() {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                current = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// A vault folder must not overlap the app data directory in either
/// direction: inside it, the mirror would write next to (or over) the
/// database and its attachments; around it, the live SQLite file would sit
/// inside a synced folder, which design.md D4 exists to prevent.
pub fn check_vault_location(root: &Path, app_data: &Path) -> Result<(), String> {
    if is_within(root, app_data) {
        return Err("choose a folder outside the app's own data folder".into());
    }
    if is_within(app_data, root) {
        return Err("choose a folder that does not contain the app's own data folder".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn is_within_matches_the_folder_itself_and_its_descendants() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("a").join("b");
        fs::create_dir_all(&inner).unwrap();
        assert!(is_within(dir.path(), dir.path()));
        assert!(is_within(&inner, dir.path()));
        assert!(!is_within(dir.path(), &inner));
    }

    #[test]
    fn is_within_sees_through_dot_dot_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        fs::create_dir_all(real.join("sub")).unwrap();
        assert!(is_within(&real.join("sub").join(".."), &real));
        #[cfg(unix)]
        {
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert!(is_within(&link.join("sub"), &real));
        }
    }

    #[test]
    fn is_within_does_not_confuse_a_shared_name_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes");
        let notes2 = dir.path().join("notes2");
        fs::create_dir_all(&notes).unwrap();
        fs::create_dir_all(&notes2).unwrap();
        assert!(!is_within(&notes2, &notes));
    }

    #[test]
    fn a_vault_may_not_overlap_the_app_data_directory() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Library").join("InstantNotes");
        let elsewhere = dir.path().join("Documents").join("Vault");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        assert!(check_vault_location(&elsewhere, &data).is_ok());
        assert!(check_vault_location(&data, &data).is_err());
        assert!(check_vault_location(&data.join("attachments"), &data).is_err());
        assert!(check_vault_location(dir.path(), &data).is_err());
    }
}
