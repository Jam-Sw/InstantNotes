use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const FILE: &str = "secrets.json";

const USED: bool = cfg!(not(any(target_os = "macos", target_os = "windows")));

pub(crate) fn default_path() -> Option<PathBuf> {
    if !USED {
        return None;
    }
    crate::LIBRARY_DB
        .get()
        .and_then(|db| db.parent())
        .map(|dir| dir.join(FILE))
}

fn read(path: &Path) -> BTreeMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write(path: &Path, map: &BTreeMap<String, String>) -> Result<(), String> {
    use std::io::Write;
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    match std::fs::remove_file(&temp) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("cannot write the secrets file: {e}")),
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|e| format!("cannot write the secrets file: {e}"))?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("cannot write the secrets file: {e}"))?;
    std::fs::rename(&temp, path).map_err(|e| format!("cannot write the secrets file: {e}"))
}

pub(crate) fn get(path: &Path, name: &str) -> Option<String> {
    read(path).remove(name)
}

pub(crate) fn set(path: &Path, name: &str, secret: &str) -> Result<(), String> {
    let mut map = read(path);
    map.insert(name.to_string(), secret.to_string());
    write(path, &map)
}

pub(crate) fn delete(path: &Path, name: &str) {
    let mut map = read(path);
    if map.remove(name).is_some() {
        let _ = write(path, &map);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_is_kept_replaced_and_deleted_in_a_private_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        assert_eq!(get(&path, "a/token"), None);
        set(&path, "a/token", "one").unwrap();
        set(&path, "a/key", "k").unwrap();
        set(&path, "a/token", "two").unwrap();
        assert_eq!(get(&path, "a/token").as_deref(), Some("two"));
        assert_eq!(get(&path, "a/key").as_deref(), Some("k"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        delete(&path, "a/token");
        assert_eq!(get(&path, "a/token"), None);
        assert_eq!(get(&path, "a/key").as_deref(), Some("k"));
    }

    #[cfg(unix)]
    #[test]
    fn a_leftover_readable_temp_file_never_carries_a_secret() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, "{}").unwrap();
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o644)).unwrap();
        set(&path, "a/token", "one").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert!(!temp.exists());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn a_system_with_a_keychain_never_falls_back_to_the_file() {
        assert_eq!(default_path(), None);
    }
}
