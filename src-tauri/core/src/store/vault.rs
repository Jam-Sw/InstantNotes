use super::*;
use crate::vault::{
    atomic_write, candidate_filenames, is_vault_file_name, note_of_surface, parse_note,
    same_surface, serialize_manifest, serialize_note, surface_ext, surface_file, surface_rel,
    FlushOutcome, Manifest, ManifestSpace, ManifestTag, VaultNote, VaultReport, VaultStatus,
};
use sha2::{Digest, Sha256};
use std::fs;

const VAULT_PATH_SETTING: &str = "vault.path";
const MANIFEST_FILE: &str = "instantnotes.yaml";
const TRASH_DIR: &str = "trash";

pub(crate) struct VaultState {
    root: PathBuf,
    last_error: Option<String>,
    last_flushed_at: Option<String>,
}

impl VaultState {
    fn new(root: PathBuf) -> Self {
        VaultState {
            root,
            last_error: None,
            last_flushed_at: None,
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn io_error(context: &str, path: &Path, e: std::io::Error) -> AppError {
    AppError::Storage(format!("{context} {}: {e}", path.display()))
}

fn root_missing(root: &Path) -> AppError {
    AppError::Storage(format!("vault folder not found: {}", root.display()))
}

fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        a.exists() && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    }
}

fn holds_our_bytes(path: &Path, sha: Option<&str>) -> bool {
    match (fs::read(path), sha) {
        (Ok(bytes), Some(sha)) => sha256_hex(&bytes) == sha,
        _ => false,
    }
}

struct WrittenFiles {
    rel: Option<String>,
    sha: Option<String>,
    board_sha: Option<String>,
}

impl Store {
    pub fn configure_vault(&mut self, root: Option<&Path>) -> Result<()> {
        let Some(root) = root else {
            self.delete_setting(VAULT_PATH_SETTING)?;
            self.forget_vault_paths()?;
            self.vault = None;
            return Ok(());
        };
        if !root.is_dir() {
            return Err(AppError::Validation(format!(
                "vault folder not found: {}",
                root.display()
            )));
        }
        let root_str = root.to_string_lossy().into_owned();
        if self.saved_vault_root()?.as_deref() != Some(root_str.as_str()) {
            self.forget_vault_paths()?;
            self.conn.execute("UPDATE notes SET vault_dirty = 1", [])?;
        }
        self.set_setting(VAULT_PATH_SETTING, serde_json::Value::String(root_str))?;
        self.vault = Some(VaultState::new(root.to_path_buf()));
        Ok(())
    }

    pub fn attach_saved_vault(&mut self) -> Result<()> {
        self.vault = self.saved_vault_root()?.map(|p| VaultState::new(p.into()));
        Ok(())
    }

    pub fn vault_root(&self) -> Option<&Path> {
        self.vault.as_ref().map(|v| v.root.as_path())
    }

    pub fn vault_status(&self) -> Result<VaultStatus> {
        let Some(state) = &self.vault else {
            return Ok(VaultStatus {
                path: None,
                pending: 0,
                last_error: None,
                last_flushed_at: None,
            });
        };
        Ok(VaultStatus {
            path: Some(state.root.to_string_lossy().into_owned()),
            pending: self.pending_vault_writes()?,
            last_error: state.last_error.clone(),
            last_flushed_at: state.last_flushed_at.clone(),
        })
    }

    pub fn vault_note(&self, id: &str) -> Result<VaultNote> {
        let note = self.fetch_note(id)?;
        let title_is_auto = self.title_is_auto(id)?;
        let tags = self
            .tags_for_note(id)?
            .into_iter()
            .map(|t| t.name)
            .collect();
        let spaces = self
            .workspaces_for_note(id)?
            .into_iter()
            .map(|w| w.name)
            .collect();
        let surface = surface_file(&note.content_kind, note.surface_data.as_deref());
        Ok(VaultNote {
            id: note.id,
            title: if title_is_auto {
                None
            } else {
                Some(note.title)
            },
            body: note.body,
            created_at: note.created_at,
            updated_at: note.updated_at,
            is_pinned: note.is_pinned,
            is_archived: note.is_archived,
            deleted_at: note.deleted_at,
            tags,
            spaces,
            kind: note.content_kind,
            surface,
        })
    }

    pub fn vault_manifest(&self) -> Result<Manifest> {
        let mut manifest = Manifest::default();
        for t in self.list_tags()? {
            manifest.tags.insert(
                t.tag.name,
                ManifestTag {
                    color: t.tag.color,
                    created: t.tag.created_at,
                },
            );
        }
        for w in self.list_workspaces()? {
            manifest.spaces.push(ManifestSpace {
                name: w.workspace.name,
                created: w.workspace.created_at,
            });
        }
        Ok(manifest)
    }

    pub fn flush_vault(&mut self, max: usize) -> Result<FlushOutcome> {
        let Some(root) = self.vault_root().map(Path::to_path_buf) else {
            return Ok(FlushOutcome::default());
        };
        let result = self.flush_into(&root, max);
        if let Some(state) = self.vault.as_mut() {
            match &result {
                Ok(out) if out.errors.is_empty() => {
                    state.last_error = None;
                    state.last_flushed_at = Some(now_iso());
                }
                Ok(out) => {
                    state.last_error = Some(match out.errors.len() {
                        1 => out.errors[0].clone(),
                        n => format!("{} (and {} more)", out.errors[0], n - 1),
                    });
                }
                Err(e) => state.last_error = Some(e.to_string()),
            }
        }
        result
    }

    pub fn verify_vault(&self) -> Result<VaultReport> {
        let root = self
            .vault_root()
            .ok_or_else(|| AppError::Validation("no vault folder is set".into()))?
            .to_path_buf();
        if !root.is_dir() {
            return Err(root_missing(&root));
        }
        let mut report = VaultReport {
            pending: self.pending_vault_writes()?,
            ..Default::default()
        };

        let rows: Vec<(String, String)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, vault_path FROM notes \
                 WHERE vault_path IS NOT NULL AND vault_dirty = 0 ORDER BY vault_path",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, rel) in rows {
            report.checked += 1;
            let expected = self.vault_note(&id)?;
            match fs::read_to_string(root.join(&rel)) {
                Err(_) => report.missing.push(rel.clone()),
                Ok(text) => {
                    let as_parsed = VaultNote {
                        surface: None,
                        ..expected.clone()
                    };
                    if parse_note(&text).ok() != Some(as_parsed) {
                        report.diverged.push(rel.clone());
                    }
                }
            }
            if let (Some(surface), Some(ext)) = (&expected.surface, surface_ext(&expected.kind)) {
                let srel = surface_rel(&rel, ext);
                match fs::read_to_string(root.join(&srel)) {
                    Err(_) => report.missing.push(srel),
                    Ok(text) if !same_surface(&expected.kind, &text, surface) => {
                        report.diverged.push(srel)
                    }
                    Ok(_) => {}
                }
            }
        }

        for (prefix, dir) in [("", root.clone()), ("trash/", root.join(TRASH_DIR))] {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_vault_file = is_vault_file_name(&name) && !name.starts_with('.');
                if !is_vault_file || !entry.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                let rel = format!("{prefix}{name}");
                let claimed = match note_of_surface(&rel) {
                    Some((note_rel, kind)) => self.surface_claims(&note_rel, kind)?,
                    None => self.vault_path_claimed(&rel, None)?,
                };
                if !claimed {
                    report.orphans.push(rel);
                }
            }
        }
        report.orphans.sort();

        let manifest = serialize_manifest(&self.vault_manifest()?);
        report.manifest_ok =
            fs::read_to_string(root.join(MANIFEST_FILE)).ok().as_deref() == Some(&manifest);
        Ok(report)
    }

    fn saved_vault_root(&self) -> Result<Option<String>> {
        Ok(self
            .get_setting(VAULT_PATH_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string)))
    }

    fn forget_vault_paths(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE notes SET vault_path = NULL, file_sha = NULL, board_sha = NULL",
            [],
        )?;
        tx.execute("DELETE FROM vault_tombstones", [])?;
        tx.commit()?;
        Ok(())
    }

    fn pending_vault_writes(&self) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE vault_dirty = 1",
            [],
            |r| r.get(0),
        )?)
    }

    fn vault_path_claimed(&self, rel: &str, except_id: Option<&str>) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM notes WHERE vault_path = ?1 COLLATE NOCASE \
                 AND (?2 IS NULL OR id <> ?2) LIMIT 1",
                params![rel, except_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn surface_claims(&self, note_rel: &str, kind: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM notes WHERE vault_path = ?1 COLLATE NOCASE \
                 AND content_kind = ?2 LIMIT 1",
                params![note_rel, kind],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn flush_into(&mut self, root: &Path, max: usize) -> Result<FlushOutcome> {
        if !root.is_dir() {
            return Err(root_missing(root));
        }
        let trash = root.join(TRASH_DIR);
        fs::create_dir_all(&trash).map_err(|e| io_error("cannot create", &trash, e))?;
        let mut out = FlushOutcome::default();

        let tombstones: Vec<(String, Option<String>)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT vault_path, file_sha FROM vault_tombstones")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (rel, sha) in tombstones {
            let path = root.join(&rel);
            let claimed = match note_of_surface(&rel) {
                Some((note_rel, _)) => self.vault_path_claimed(&note_rel, None)?,
                None => self.vault_path_claimed(&rel, None)?,
            };
            if !claimed && holds_our_bytes(&path, sha.as_deref()) {
                if let Err(e) = fs::remove_file(&path) {
                    out.errors
                        .push(io_error("cannot remove", &path, e).to_string());
                    continue;
                }
                out.removed += 1;
            }
            self.conn.execute(
                "DELETE FROM vault_tombstones WHERE vault_path = ?1",
                params![rel],
            )?;
        }

        let dirty: Vec<(String, WrittenFiles)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, vault_path, file_sha, board_sha FROM notes WHERE vault_dirty = 1 \
                 ORDER BY seq LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![max as i64], |r| {
                Ok((
                    r.get(0)?,
                    WrittenFiles {
                        rel: r.get(1)?,
                        sha: r.get(2)?,
                        board_sha: r.get(3)?,
                    },
                ))
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, old) in dirty {
            match self.write_note_file(root, &id, &old) {
                Ok(()) => out.written += 1,
                Err(e) => out.errors.push(format!("note {id}: {e}")),
            }
        }

        let manifest = serialize_manifest(&self.vault_manifest()?);
        let manifest_path = root.join(MANIFEST_FILE);
        if fs::read(&manifest_path).ok().as_deref() != Some(manifest.as_bytes()) {
            if let Err(e) = atomic_write(&manifest_path, manifest.as_bytes()) {
                out.errors
                    .push(io_error("cannot write", &manifest_path, e).to_string());
            }
        }

        out.remaining = self.pending_vault_writes()?;
        Ok(out)
    }

    fn write_note_file(&mut self, root: &Path, id: &str, old: &WrittenFiles) -> Result<()> {
        let note = self.vault_note(id)?;
        let bytes = serialize_note(&note);
        let surface = note.surface.as_deref();
        let ext = surface_ext(&note.kind);
        let title = note
            .title
            .clone()
            .unwrap_or_else(|| domain::derive_title(&note.body));
        let old_rel = old.rel.as_deref();
        let old_path = old_rel.map(|r| root.join(r));
        let old_surface = old_rel
            .zip(ext)
            .map(|(r, ext)| root.join(surface_rel(r, ext)));

        let mut chosen = None;
        for name in candidate_filenames(&title, id) {
            let rel = if note.deleted_at.is_some() {
                format!("{TRASH_DIR}/{name}")
            } else {
                name
            };
            if old_rel == Some(rel.as_str()) {
                chosen = Some(rel);
                break;
            }
            if self.vault_path_claimed(&rel, Some(id))? {
                continue;
            }
            let path = root.join(&rel);
            let adopted = fs::read_to_string(&path)
                .ok()
                .and_then(|text| parse_note(&text).ok())
                .is_some_and(|existing| existing.id == id);
            let ours = |path: &Path, old: Option<&Path>| {
                fs::symlink_metadata(path).is_err()
                    || old.is_some_and(|old| same_file(old, path))
                    || adopted
            };
            let surface_ok = match ext {
                None => true,
                Some(ext) => ours(&root.join(surface_rel(&rel, ext)), old_surface.as_deref()),
            };
            if ours(&path, old_path.as_deref()) && surface_ok {
                chosen = Some(rel);
                break;
            }
        }
        let rel =
            chosen.ok_or_else(|| AppError::Conflict(format!("no free filename for note {id}")))?;
        let path = root.join(&rel);
        let surface_path = ext.map(|ext| root.join(surface_rel(&rel, ext)));
        let moved = old_rel.is_some_and(|r| r != rel);
        let files: Vec<(Option<&Path>, &Path, Option<&str>)> = [
            Some((old_path.as_deref(), path.as_path(), old.sha.as_deref())),
            surface_path
                .as_deref()
                .map(|new| (old_surface.as_deref(), new, old.board_sha.as_deref())),
        ]
        .into_iter()
        .flatten()
        .collect();

        if moved {
            for (old, new, _) in &files {
                if let Some(old) = old.filter(|old| same_file(old, new)) {
                    fs::rename(old, new).map_err(|e| io_error("cannot rename", old, e))?;
                }
            }
        }
        atomic_write(&path, bytes.as_bytes()).map_err(|e| io_error("cannot write", &path, e))?;
        if let (Some(surface), Some(surface_path)) = (surface, &surface_path) {
            atomic_write(surface_path, surface.as_bytes())
                .map_err(|e| io_error("cannot write", surface_path, e))?;
        }
        if moved {
            for (old, new, sha) in &files {
                if let Some(old) =
                    old.filter(|old| !same_file(old, new) && holds_our_bytes(old, *sha))
                {
                    fs::remove_file(old).map_err(|e| io_error("cannot remove", old, e))?;
                }
            }
        }

        self.conn.execute(
            "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = ?3, vault_dirty = 0 \
             WHERE id = ?4",
            params![
                rel,
                sha256_hex(bytes.as_bytes()),
                surface.map(|c| sha256_hex(c.as_bytes())),
                id
            ],
        )?;
        Ok(())
    }
}
