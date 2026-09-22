//! Stage 2 of the portable vault: the live mirror (dual-write, design.md §6).
//! SQLite stays authoritative. Migration v5's triggers set `vault_dirty` in
//! the same transaction as every write that changes a note's file;
//! `flush_vault` writes those notes out and clears the flag. Nothing here
//! reads the vault back into the store.
//!
//! Safety rules, each pinned by `core/tests/vault_mirror_test.rs`:
//! - Only files the mirror owns are written or removed: a path recorded in
//!   `vault_path` or a tombstone, or a file whose frontmatter `id` is the
//!   note's own. Anything else at a target name is left alone and the note
//!   takes a suffixed name instead.
//! - A removal happens only while the file still holds the bytes the mirror
//!   wrote (`file_sha`); a file edited outside the app is left in place.
//! - The vault root is never created. A missing root (an unmounted drive)
//!   fails the flush and leaves every note dirty until it returns.

use super::*;
use crate::vault::{
    atomic_write, candidate_filenames, parse_note, serialize_manifest, serialize_note,
    FlushOutcome, Manifest, ManifestSpace, ManifestTag, VaultNote, VaultReport, VaultStatus,
};
use sha2::{Digest, Sha256};
use std::fs;

/// Device-local, like every other setting: another device's vault lives
/// wherever that device keeps it.
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
    format!("{:x}", Sha256::digest(bytes))
}

fn io_error(context: &str, path: &Path, e: std::io::Error) -> AppError {
    AppError::Storage(format!("{context} {}: {e}", path.display()))
}

fn root_missing(root: &Path) -> AppError {
    AppError::Storage(format!("vault folder not found: {}", root.display()))
}

/// Whether two paths name one file. On a case-insensitive filesystem
/// `notes.md` and `Notes.md` do, which is what makes a case-only rename
/// dangerous: removing the "old" path would delete the new file.
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

/// Whether the file at `path` still holds exactly the bytes we wrote.
fn holds_our_bytes(path: &Path, sha: Option<&str>) -> bool {
    match (fs::read(path), sha) {
        (Ok(bytes), Some(sha)) => sha256_hex(&bytes) == sha,
        _ => false,
    }
}

impl Store {
    /// Point the mirror at `root`, or stop mirroring with `None`. A new root
    /// starts from scratch: every note is marked for writing and the old
    /// folder is left exactly as it was. Stopping leaves the files in place.
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

    /// Resume the mirror saved by `configure_vault`, at startup. The folder
    /// need not exist right now (an unmounted drive): flushes report it
    /// missing and keep notes pending until it is back.
    pub fn attach_saved_vault(&mut self) -> Result<()> {
        self.vault = self.saved_vault_root()?.map(|p| VaultState::new(p.into()));
        Ok(())
    }

    /// The configured vault root, if any.
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

    /// One note in the shape its vault file carries.
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
        })
    }

    /// What `instantnotes.yaml` holds: tag colors and every space, including
    /// empty ones (design.md §3.4).
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

    /// Write up to `max` pending notes, process queued removals, and refresh
    /// `instantnotes.yaml` when it changed. A failure on one note is
    /// recorded in the outcome and the note stays pending; only a missing
    /// root fails the whole flush. With no vault configured this is a no-op.
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

    /// Compare the vault against the store without changing either. Notes
    /// still pending are counted, not compared: their files are stale by
    /// definition until the next flush.
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
            match fs::read_to_string(root.join(&rel)) {
                Err(_) => report.missing.push(rel),
                Ok(text) => {
                    if parse_note(&text).ok() != Some(self.vault_note(&id)?) {
                        report.diverged.push(rel);
                    }
                }
            }
        }

        for (prefix, dir) in [("", root.clone()), ("trash/", root.join(TRASH_DIR))] {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_note_file = name.ends_with(".md") && !name.starts_with('.');
                if !is_note_file || !entry.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                let rel = format!("{prefix}{name}");
                if !self.vault_path_claimed(&rel, None)? {
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

    // ---- internals ----

    fn saved_vault_root(&self) -> Result<Option<String>> {
        Ok(self
            .get_setting(VAULT_PATH_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string)))
    }

    /// Drop every record of files in the current vault. Used when the root
    /// changes or mirroring stops: those files are no longer ours to manage.
    fn forget_vault_paths(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("UPDATE notes SET vault_path = NULL, file_sha = NULL", [])?;
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

    /// Whether a note other than `except_id` has its file at `rel`.
    /// Case-insensitive, like the filesystems the vault usually lives on.
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

    fn flush_into(&mut self, root: &Path, max: usize) -> Result<FlushOutcome> {
        if !root.is_dir() {
            return Err(root_missing(root));
        }
        let trash = root.join(TRASH_DIR);
        fs::create_dir_all(&trash).map_err(|e| io_error("cannot create", &trash, e))?;
        let mut out = FlushOutcome::default();

        // Removals first, so a name freed by a deleted note is free for any
        // note written below.
        let tombstones: Vec<(String, Option<String>)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT vault_path, file_sha FROM vault_tombstones")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (rel, sha) in tombstones {
            let path = root.join(&rel);
            if !self.vault_path_claimed(&rel, None)? && holds_our_bytes(&path, sha.as_deref()) {
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

        let dirty: Vec<(String, Option<String>, Option<String>)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, vault_path, file_sha FROM notes WHERE vault_dirty = 1 \
                 ORDER BY seq LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![max as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, old_rel, old_sha) in dirty {
            match self.write_note_file(root, &id, old_rel.as_deref(), old_sha.as_deref()) {
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

    /// Write one note's file, moving it when its name or trash state
    /// changed, then record where it went and mark it clean.
    fn write_note_file(
        &mut self,
        root: &Path,
        id: &str,
        old_rel: Option<&str>,
        old_sha: Option<&str>,
    ) -> Result<()> {
        let note = self.vault_note(id)?;
        let bytes = serialize_note(&note);
        let title = note
            .title
            .clone()
            .unwrap_or_else(|| domain::derive_title(&note.body));
        let old_path = old_rel.map(|r| root.join(r));

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
            let free = fs::symlink_metadata(&path).is_err();
            let ours = free
                || old_path.as_deref().is_some_and(|old| same_file(old, &path))
                || fs::read_to_string(&path)
                    .ok()
                    .and_then(|text| parse_note(&text).ok())
                    .is_some_and(|existing| existing.id == id);
            if ours {
                chosen = Some(rel);
                break;
            }
        }
        let rel =
            chosen.ok_or_else(|| AppError::Conflict(format!("no free filename for note {id}")))?;
        let path = root.join(&rel);

        if let Some(old) = old_path
            .as_deref()
            .filter(|_| old_rel != Some(rel.as_str()))
        {
            // A case-only rename of our own file: rename first, or on a
            // case-insensitive filesystem the write below keeps the old
            // spelling and the removal below would take the only copy.
            if same_file(old, &path) {
                fs::rename(old, &path).map_err(|e| io_error("cannot rename", old, e))?;
            }
        }
        atomic_write(&path, bytes.as_bytes()).map_err(|e| io_error("cannot write", &path, e))?;
        if let Some(old) = old_path
            .as_deref()
            .filter(|_| old_rel != Some(rel.as_str()))
        {
            // Left behind when edited outside the app: that edit is not ours
            // to discard, and verify reports the file as an orphan.
            if !same_file(old, &path) && holds_our_bytes(old, old_sha) {
                fs::remove_file(old).map_err(|e| io_error("cannot remove", old, e))?;
            }
        }

        self.conn.execute(
            "UPDATE notes SET vault_path = ?1, file_sha = ?2, vault_dirty = 0 WHERE id = ?3",
            params![rel, sha256_hex(bytes.as_bytes()), id],
        )?;
        Ok(())
    }
}
