use crate::vaults::{self, Vault};
use instantnotes_core::{AppError, Store};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DB_FILE: &str = "library.db";
pub const ATTACHMENTS_DIR: &str = "attachments";

pub struct Library {
    pub store: Store,
    pub db: PathBuf,
    pub attachments: PathBuf,
    pub vault: Option<Arc<Vault>>,
    last_used: Instant,
}

pub type Synced = (Arc<Mutex<Library>>, Arc<Vault>);

pub struct Libraries {
    root: PathBuf,
    idle: Duration,
    vault_root: Option<PathBuf>,
    open: Mutex<HashMap<String, Arc<Mutex<Library>>>>,
}

pub fn folder_name(sub: &str) -> String {
    let plain = !sub.is_empty()
        && sub.len() <= 128
        && sub
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if plain {
        sub.to_string()
    } else {
        let digest = Sha256::digest(sub.as_bytes());
        digest.iter().map(|b| format!("{b:02x}")).collect()
    }
}

fn storage(e: std::io::Error, what: &str) -> AppError {
    AppError::Storage(format!("{what}: {e}"))
}

pub(crate) fn create_private_dir(dir: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dir).map_err(|e| storage(e, "cannot create library folder"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| storage(e, "cannot protect library folder"))?;
    }
    Ok(())
}

impl Libraries {
    pub fn new(data_dir: &Path, idle: Duration, vault_root: Option<PathBuf>) -> Self {
        Libraries {
            root: data_dir.join("libraries"),
            idle,
            vault_root,
            open: Mutex::new(HashMap::new()),
        }
    }

    pub fn dir_for(&self, sub: &str) -> PathBuf {
        self.root.join(folder_name(sub))
    }

    fn open_library(&self, sub: &str) -> Result<Library, AppError> {
        let dir = self.dir_for(sub);
        create_private_dir(&dir)?;
        let attachments = dir.join(ATTACHMENTS_DIR);
        create_private_dir(&attachments)?;
        let db = dir.join(DB_FILE);
        let started = Instant::now();
        let mut store = Store::open(&db)?;
        Store::mark_session_open(&db);
        let vault = self
            .vault_root
            .as_deref()
            .and_then(|root| vaults::attach(&mut store, root, sub, &attachments))
            .map(Arc::new);
        crate::log(
            "library.open",
            &[
                ("library", &folder_name(sub)),
                ("ms", &started.elapsed().as_millis().to_string()),
            ],
        );
        Ok(Library {
            store,
            db,
            attachments,
            vault,
            last_used: Instant::now(),
        })
    }

    fn handle(&self, sub: &str) -> Result<Arc<Mutex<Library>>, AppError> {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(found) = open.get(sub) {
            return Ok(Arc::clone(found));
        }
        let library = Arc::new(Mutex::new(self.open_library(sub)?));
        open.insert(sub.to_string(), Arc::clone(&library));
        Ok(library)
    }

    pub fn with<T>(
        &self,
        sub: &str,
        f: impl FnOnce(&mut Library) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let handle = self.handle(sub)?;
        let mut library = handle.lock().unwrap_or_else(|e| e.into_inner());
        library.last_used = Instant::now();
        let result = f(&mut library);
        if let Err(e) = &result {
            if e.is_corruption() {
                Store::mark_library_suspect(&library.db);
            }
        }
        result
    }

    pub fn vault(&self, sub: &str) -> Result<Option<Synced>, AppError> {
        let handle = self.handle(sub)?;
        let vault = handle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .vault
            .clone();
        Ok(vault.map(|vault| (handle, vault)))
    }

    pub fn open_vaults(&self) -> Vec<(String, Synced)> {
        let open: Vec<(String, Arc<Mutex<Library>>)> = {
            let open = self.open.lock().unwrap_or_else(|e| e.into_inner());
            open.iter()
                .map(|(sub, lib)| (sub.clone(), Arc::clone(lib)))
                .collect()
        };
        open.into_iter()
            .filter_map(|(sub, lib)| {
                let vault = lib
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .vault
                    .clone()?;
                Some((sub, (lib, vault)))
            })
            .collect()
    }

    pub fn close_idle(&self) {
        let now = Instant::now();
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        let idle: Vec<String> = open
            .iter()
            .filter(|(_, lib)| {
                lib.try_lock()
                    .map(|l| now.duration_since(l.last_used) >= self.idle)
                    .unwrap_or(false)
            })
            .map(|(sub, _)| sub.clone())
            .collect();
        for sub in idle {
            if let Some(lib) = open.remove(&sub) {
                if let Ok(lib) = lib.lock() {
                    Store::mark_session_closed(&lib.db);
                }
                crate::log("library.close", &[("library", &folder_name(&sub))]);
            }
        }
    }

    pub fn close_all(&self) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        for (_, lib) in open.drain() {
            if let Ok(lib) = lib.lock() {
                Store::mark_session_closed(&lib.db);
            }
        }
    }

    pub fn exists(&self, sub: &str) -> bool {
        self.dir_for(sub).join(DB_FILE).is_file()
    }

    pub fn remove(&self, sub: &str) -> std::io::Result<bool> {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(lib) = open.remove(sub) {
            if let Ok(lib) = lib.lock() {
                Store::mark_session_closed(&lib.db);
            }
        }
        let dir = self.dir_for(sub);
        if !dir.exists() {
            return Ok(false);
        }
        std::fs::remove_dir_all(&dir)?;
        crate::log("legacy.removed", &[("library", &folder_name(sub))]);
        Ok(true)
    }

    pub fn open_count(&self) -> usize {
        self.open.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}
