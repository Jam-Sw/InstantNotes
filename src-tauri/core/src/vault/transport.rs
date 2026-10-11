use super::scan::{is_vault_root, MANIFEST_FILE};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const FOLDER: &str = "folder";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reach {
    Ready,
    Unreachable(String),
}

pub trait Transport: Send {
    fn name(&self) -> &'static str;
    fn root(&self) -> &Path;
    fn interval(&self) -> Duration;
    fn pull(&mut self) -> Reach;
    fn push(&mut self) -> Reach;
}

pub fn reach(root: &Path) -> Reach {
    if !root.is_dir() {
        return Reach::Unreachable(format!("vault folder not found: {}", root.display()));
    }
    if !is_vault_root(root) {
        return Reach::Unreachable(format!(
            "vault folder has no {MANIFEST_FILE}: {}",
            root.display()
        ));
    }
    Reach::Ready
}

pub struct Folder {
    root: PathBuf,
}

impl Folder {
    pub fn new(root: PathBuf) -> Folder {
        Folder { root }
    }
}

impl Transport for Folder {
    fn name(&self) -> &'static str {
        FOLDER
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn pull(&mut self) -> Reach {
        reach(&self.root)
    }

    fn push(&mut self) -> Reach {
        reach(&self.root)
    }
}

pub fn open(name: &str, root: PathBuf) -> Result<Box<dyn Transport>, String> {
    match name {
        FOLDER => Ok(Box::new(Folder::new(root))),
        other => Err(format!("unknown vault transport: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_folder_is_ready_only_while_it_holds_the_marker() {
        let dir = tempfile::tempdir().unwrap();
        let mut folder = Folder::new(dir.path().to_path_buf());
        assert!(matches!(folder.pull(), Reach::Unreachable(m) if m.contains(MANIFEST_FILE)));
        fs::write(dir.path().join(MANIFEST_FILE), "{}\n").unwrap();
        assert_eq!(folder.pull(), Reach::Ready);
        assert_eq!(folder.push(), Reach::Ready);
        let mut gone = Folder::new(dir.path().join("unmounted"));
        assert!(
            matches!(gone.pull(), Reach::Unreachable(m) if m.starts_with("vault folder not found"))
        );
    }

    #[test]
    fn transports_open_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let t = open(FOLDER, dir.path().to_path_buf()).unwrap();
        assert_eq!(t.name(), FOLDER);
        assert_eq!(t.root(), dir.path());
        assert!(open("carrier-pigeon", dir.path().to_path_buf()).is_err());
    }
}
