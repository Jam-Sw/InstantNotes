use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    let tmp_path = dir.join(format!(
        ".{}.tmp-{}-{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("vault-write"),
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed)
    ));

    let mut tmp = File::create(&tmp_path)?;
    io::Write::write_all(&mut tmp, bytes)?;
    tmp.sync_all()?;
    drop(tmp);

    fs::rename(&tmp_path, path)?;
    Ok(())
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), dst_path)?;
        }
    }
    Ok(())
}

pub fn copy_missing_files(src: &Path, dst: &Path) -> io::Result<usize> {
    fs::create_dir_all(dst)?;
    let mut copied = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let target = dst.join(entry.file_name());
        if fs::symlink_metadata(&target).is_err() {
            fs::copy(entry.path(), target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn writes_the_bytes_to_the_target_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn overwrites_an_existing_file_completely() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"a much longer first version").unwrap();
        atomic_write(&path, b"short").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "short");
    }

    #[test]
    fn leaves_no_temp_file_behind_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"hello").unwrap();
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("note.md")]);
    }

    #[test]
    fn errors_when_the_parent_directory_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing-subdir").join("note.md");
        assert!(atomic_write(&path, b"hello").is_err());
    }

    #[test]
    fn copy_dir_recursive_copies_nested_files_and_creates_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir_all(src.join("nested")).unwrap();
        fs::write(src.join("a.png"), b"a-bytes").unwrap();
        fs::write(src.join("nested").join("b.png"), b"b-bytes").unwrap();

        let dst = dir.path().join("dst");
        copy_dir_recursive(&src, &dst).unwrap();

        assert_eq!(fs::read(dst.join("a.png")).unwrap(), b"a-bytes");
        assert_eq!(
            fs::read(dst.join("nested").join("b.png")).unwrap(),
            b"b-bytes"
        );
    }

    #[test]
    fn copy_missing_files_copies_only_what_the_destination_lacks() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        let dst = dir.path().join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("new.png"), b"new").unwrap();
        fs::write(src.join("have.png"), b"source").unwrap();
        fs::write(dst.join("have.png"), b"already there").unwrap();

        assert_eq!(copy_missing_files(&src, &dst).unwrap(), 1);
        assert_eq!(fs::read(dst.join("new.png")).unwrap(), b"new");
        assert_eq!(fs::read(dst.join("have.png")).unwrap(), b"already there");
        assert_eq!(copy_missing_files(&src, &dst).unwrap(), 0);
    }

    #[test]
    fn copy_dir_recursive_on_an_empty_source_just_creates_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        let dst = dir.path().join("dst");
        copy_dir_recursive(&src, &dst).unwrap();
        assert!(dst.is_dir());
    }
}
