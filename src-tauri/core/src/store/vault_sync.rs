use super::vault::{io_error, sha256_hex, MANIFEST_BASE_SETTING};
use super::*;
use crate::sheet::Sheet;
use crate::vault::reconcile::{
    conflict_title, decide, derived_id, equivalent, Decision, Remote, Side, Synced,
};
use crate::vault::sync::{CycleReport, Ingest, Removals};
use crate::vault::{
    atomic_write, merge_manifest, parse_manifest, parse_note, serialize_manifest, serialize_note,
    surface_ext, surface_from_file, surface_rel, Listing, Manifest, ParseError, VaultNote,
    MANIFEST_FILE, TRASH_DIR,
};
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;

pub const CONFLICT_TAG: &str = "conflict";
const MASS_REMOVAL_FLOOR: usize = 20;

struct Row {
    rel: Option<String>,
    sha: Option<String>,
    board_sha: Option<String>,
    dirty: bool,
}

enum Read {
    Missing,
    Unchanged,
    Found(Box<Found>),
}

struct Found {
    note: VaultNote,
    raw: VaultNote,
    sha: String,
    surface_sha: Option<String>,
    rewrite: bool,
}

fn file_time(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(iso)
        .unwrap_or_else(|_| now_iso())
}

fn read_text(path: &Path) -> Result<Option<(String, String)>> {
    match fs::read(path) {
        Ok(bytes) => {
            let sha = sha256_hex(&bytes);
            let text = String::from_utf8(bytes)
                .map_err(|_| AppError::Validation("the file is not UTF-8 text".into()))?;
            Ok(Some((text, sha)))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error("cannot read", path, e)),
    }
}

fn adopt(rel: &str, text: &str, sha: &str, path: &Path) -> VaultNote {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let stem = name.strip_suffix(".md").unwrap_or(name).trim();
    let at = file_time(path);
    VaultNote {
        id: derived_id(&["adopt", rel, sha]),
        title: (!stem.is_empty()).then(|| stem.to_string()),
        body: text.to_string(),
        created_at: at.clone(),
        updated_at: at,
        is_pinned: false,
        is_archived: false,
        deleted_at: None,
        tags: Vec::new(),
        spaces: Vec::new(),
        kind: CONTENT_KIND_DOCUMENT.to_string(),
        surface: None,
    }
}

fn as_conflict(source: &VaultNote, id: String) -> VaultNote {
    let title = source
        .title
        .clone()
        .unwrap_or_else(|| domain::derive_title(&source.body));
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let mut tags = source.tags.clone();
    tags.push(CONFLICT_TAG.to_string());
    VaultNote {
        id,
        title: Some(conflict_title(&title, &stamp)),
        tags,
        is_pinned: false,
        ..source.clone()
    }
}

fn known_kind(kind: &str) -> bool {
    matches!(
        kind,
        CONTENT_KIND_DOCUMENT | CONTENT_KIND_WHITEBOARD | CONTENT_KIND_SHEET
    )
}

impl Store {
    pub fn ingest_vault_files(&mut self, root: &Path, rels: &[String]) -> Result<Ingest> {
        let mut out = Ingest::default();
        for rel in rels {
            match self.ingest_vault_file(root, rel, &mut out) {
                Ok(true) => out.settled.push(rel.clone()),
                Ok(false) => {}
                Err(e) => out.errors.push(format!("{rel}: {e}")),
            }
        }
        Ok(out)
    }

    pub fn ingest_vault_removals(&mut self, root: &Path, listing: &Listing) -> Result<Removals> {
        let listed: HashSet<String> = listing.files.keys().map(|r| r.to_lowercase()).collect();
        let rows: Vec<(String, Option<String>, bool, bool)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, vault_path, is_deleted, vault_dirty FROM notes \
                 WHERE file_sha IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get::<_, i64>(2)? != 0,
                    r.get::<_, i64>(3)? != 0,
                ))
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let known = rows.len();
        let gone: Vec<(String, bool)> = rows
            .into_iter()
            .filter(|(_, rel, _, dirty)| {
                !dirty
                    && rel.as_ref().is_none_or(|rel| {
                        !listed.contains(&rel.to_lowercase())
                            && fs::symlink_metadata(root.join(rel)).is_err()
                    })
            })
            .map(|(id, _, deleted, _)| (id, deleted))
            .collect();
        let allowed = self.vault.as_ref().is_some_and(|v| v.allow_mass_removal);
        if gone.len() > MASS_REMOVAL_FLOOR && gone.len() * 2 > known && !allowed {
            return Ok(Removals {
                trashed: Vec::new(),
                held: gone.len(),
            });
        }
        let now = now_iso();
        let tx = self.conn.unchecked_transaction()?;
        let mut trashed = Vec::new();
        for (id, deleted) in gone {
            if !deleted {
                tx.execute(
                    "UPDATE notes SET is_deleted = 1, deleted_at = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
                trashed.push(id.clone());
            }
            tx.execute(
                "UPDATE notes SET vault_path = NULL, file_sha = NULL, board_sha = NULL, \
                 vault_dirty = 0 WHERE id = ?1",
                params![id],
            )?;
        }
        tx.commit()?;
        if let Some(state) = self.vault.as_mut() {
            state.allow_mass_removal = false;
        }
        Ok(Removals { trashed, held: 0 })
    }

    pub fn sync_vault_manifest(&mut self, root: &Path) -> Result<bool> {
        let path = root.join(MANIFEST_FILE);
        let theirs_text =
            fs::read_to_string(&path).map_err(|e| io_error("cannot read", &path, e))?;
        let theirs = parse_manifest(&theirs_text)
            .map_err(|e| AppError::Validation(format!("{MANIFEST_FILE} cannot be read: {e}")))?;
        let base_text = self
            .get_setting(MANIFEST_BASE_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string));
        let base = base_text.as_deref().and_then(|t| parse_manifest(t).ok());
        let ours = self.vault_manifest()?;
        let merged = merge_manifest(base.as_ref(), &ours, &theirs);
        let changed = self.apply_manifest(&ours, &merged)?;
        let text = serialize_manifest(&self.vault_manifest()?);
        if text != theirs_text {
            atomic_write(&path, text.as_bytes()).map_err(|e| io_error("cannot write", &path, e))?;
        }
        if base_text.as_deref() != Some(text.as_str()) {
            self.set_setting(MANIFEST_BASE_SETTING, serde_json::Value::String(text))?;
        }
        Ok(changed)
    }

    pub fn confirm_vault_removals(&mut self) -> Result<()> {
        let state = self
            .vault
            .as_mut()
            .ok_or_else(|| AppError::Validation("no vault folder is set".into()))?;
        state.allow_mass_removal = true;
        Ok(())
    }

    pub fn record_vault_sync(&mut self, report: &CycleReport) {
        let Some(state) = self.vault.as_mut() else {
            return;
        };
        state.unreachable = report.unreachable.clone();
        state.held_removals = report.held_removals;
        state.conflicts += report.conflicts;
        if report.unreachable.is_some() {
            return;
        }
        state.last_error = match report.errors.len() {
            0 => None,
            1 => Some(report.errors[0].clone()),
            n => Some(format!("{} (and {} more)", report.errors[0], n - 1)),
        };
        if report.errors.is_empty() {
            state.last_synced_at = Some(now_iso());
        }
    }

    fn ingest_vault_file(&mut self, root: &Path, rel: &str, out: &mut Ingest) -> Result<bool> {
        let found = match self.read_vault_file(root, rel)? {
            Read::Missing => return Ok(false),
            Read::Unchanged => return Ok(true),
            Read::Found(found) => *found,
        };
        let Found {
            note,
            raw,
            sha,
            surface_sha,
            rewrite,
        } = found;
        let tx = self.conn.unchecked_transaction()?;
        if let Some(owner) = self.vault_path_owner(rel)? {
            if owner != note.id {
                self.conn.execute(
                    "UPDATE notes SET vault_path = NULL WHERE id = ?1",
                    params![owner],
                )?;
            }
        }
        let row = self.vault_row(&note.id)?;
        let local = match &row {
            Some(_) => Some(self.vault_note(&note.id)?),
            None => None,
        };
        let tombstoned = self.tombstoned(rel, &sha)?;
        let synced = row.as_ref().map(|r| Synced {
            sha: r.sha.as_deref(),
            surface_sha: r.board_sha.as_deref(),
            dirty: r.dirty,
        });
        let remote = Remote {
            note: &note,
            sha: &sha,
            surface_sha: surface_sha.as_deref(),
        };
        let mut decision = decide(local.as_ref().zip(synced), remote, tombstoned);
        if decision == Decision::Unchanged {
            let trashed_here = local.as_ref().is_some_and(|n| n.deleted_at.is_some());
            let clean = row.as_ref().is_some_and(|r| !r.dirty);
            if trashed_here != note.deleted_at.is_some() && clean {
                decision = Decision::Take;
            }
        }

        let record = |store: &Store, dirty: bool| -> Result<()> {
            let compare = VaultNote {
                surface: note.surface.clone(),
                ..raw.clone()
            };
            let dirty = dirty || rewrite || !equivalent(&compare, &store.vault_note(&note.id)?);
            store.conn.execute(
                "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = ?3, \
                 vault_dirty = ?4 WHERE id = ?5",
                params![rel, sha, surface_sha, i64::from(dirty), note.id],
            )?;
            Ok(())
        };
        let mut changed = Vec::new();
        match decision {
            Decision::Skip => {}
            Decision::Unchanged => {
                if row.as_ref().and_then(|r| r.rel.as_deref()) != Some(rel) {
                    self.conn.execute(
                        "UPDATE notes SET vault_path = ?1 WHERE id = ?2",
                        params![rel, note.id],
                    )?;
                }
            }
            Decision::Same => record(self, false)?,
            Decision::Insert => {
                self.insert_from_vault(&note)?;
                record(self, false)?;
                changed.push(note.id.clone());
            }
            Decision::Take => {
                self.apply_from_vault(&note)?;
                record(self, false)?;
                changed.push(note.id.clone());
            }
            Decision::Fork(Side::Local) => {
                if let Some(copy) = self.copy_from_vault(&note, &sha)? {
                    out.conflicts += 1;
                    changed.push(copy);
                }
                self.conn.execute(
                    "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = ?3, \
                     vault_dirty = 1 WHERE id = ?4",
                    params![rel, sha, surface_sha, note.id],
                )?;
            }
            Decision::Fork(Side::Remote) => {
                let mine = local.as_ref().expect("a fork has a local side");
                let mine_sha = sha256_hex(serialize_note(mine).as_bytes());
                if let Some(copy) = self.copy_from_vault(mine, &mine_sha)? {
                    out.conflicts += 1;
                    changed.push(copy);
                }
                self.apply_from_vault(&note)?;
                record(self, false)?;
                changed.push(note.id.clone());
            }
        }
        tx.commit()?;
        out.changed.extend(changed);
        Ok(true)
    }

    fn read_vault_file(&self, root: &Path, rel: &str) -> Result<Read> {
        let path = root.join(rel);
        let Some((text, sha)) = read_text(&path)? else {
            return Ok(Read::Missing);
        };
        let owner = self.vault_path_owner(rel)?;
        if let Some(owner) = &owner {
            if self.holds_synced_files(root, rel, owner, &sha)? {
                return Ok(Read::Unchanged);
            }
        }
        let (raw, adopted) = match parse_note(&text) {
            Ok(note) => (note, false),
            Err(ParseError::MissingFrontmatter) if owner.is_none() => {
                (adopt(rel, &text, &sha, &path), true)
            }
            Err(e) => return Err(AppError::Validation(e.to_string())),
        };
        let mut note = raw.clone();
        let mut rewrite = adopted;
        let in_trash = rel.starts_with(&format!("{TRASH_DIR}/"));
        note.deleted_at = if in_trash {
            note.deleted_at.or_else(|| Some(file_time(&path)))
        } else {
            None
        };
        if !known_kind(&note.kind) {
            note.kind = CONTENT_KIND_DOCUMENT.to_string();
            rewrite = true;
        }
        let mut surface_sha = None;
        if let Some(ext) = surface_ext(&note.kind) {
            if let Some((text, sha)) = read_text(&root.join(surface_rel(rel, ext)))? {
                note.surface = Some(text);
                surface_sha = Some(sha);
            }
        }
        if let Some(own_rel) = self.vault_row(&note.id)?.and_then(|r| r.rel) {
            if !own_rel.eq_ignore_ascii_case(rel) && self.file_carries(root, &own_rel, &note.id) {
                note = as_conflict(&note, derived_id(&["copy", &note.id, rel]));
                rewrite = true;
            }
        }
        Ok(Read::Found(Box::new(Found {
            note,
            raw,
            sha,
            surface_sha,
            rewrite,
        })))
    }

    fn holds_synced_files(&self, root: &Path, rel: &str, id: &str, sha: &str) -> Result<bool> {
        let Some(row) = self.vault_row(id)? else {
            return Ok(false);
        };
        if row.sha.as_deref() != Some(sha) {
            return Ok(false);
        }
        let kind: String = self.conn.query_row(
            "SELECT content_kind FROM notes WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        let Some(ext) = surface_ext(&kind) else {
            return Ok(true);
        };
        let surface = read_text(&root.join(surface_rel(rel, ext)))?.map(|(_, sha)| sha);
        Ok(surface == row.board_sha)
    }

    fn file_carries(&self, root: &Path, rel: &str, id: &str) -> bool {
        fs::read_to_string(root.join(rel))
            .ok()
            .and_then(|text| parse_note(&text).ok())
            .is_some_and(|n| n.id == id)
    }

    fn vault_path_owner(&self, rel: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id FROM notes WHERE vault_path = ?1 COLLATE NOCASE LIMIT 1",
                params![rel],
                |r| r.get(0),
            )
            .optional()?)
    }

    fn vault_row(&self, id: &str) -> Result<Option<Row>> {
        Ok(self
            .conn
            .query_row(
                "SELECT vault_path, file_sha, board_sha, vault_dirty FROM notes WHERE id = ?1",
                params![id],
                |r| {
                    Ok(Row {
                        rel: r.get(0)?,
                        sha: r.get(1)?,
                        board_sha: r.get(2)?,
                        dirty: r.get::<_, i64>(3)? != 0,
                    })
                },
            )
            .optional()?)
    }

    fn tombstoned(&self, rel: &str, sha: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM vault_tombstones WHERE vault_path = ?1 COLLATE NOCASE \
                 AND file_sha = ?2",
                params![rel, sha],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn vault_fields(
        &self,
        note: &VaultNote,
        existing_surface: Option<&str>,
    ) -> Result<(String, bool, String, Option<String>)> {
        let surface_data = surface_from_file(&note.kind, note.surface.as_deref(), existing_surface)
            .map_err(AppError::Validation)?;
        let body = match (&note.kind[..], &surface_data) {
            (CONTENT_KIND_SHEET, Some(raw)) => {
                Sheet::parse(raw).map_err(AppError::Validation)?.markdown()
            }
            _ => note.body.clone(),
        };
        let explicit = note
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty());
        let title = explicit
            .map(str::to_string)
            .unwrap_or_else(|| domain::derive_title(&body));
        Ok((title, explicit.is_none(), body, surface_data))
    }

    fn insert_from_vault(&self, note: &VaultNote) -> Result<()> {
        let (title, title_is_auto, body, surface_data) = self.vault_fields(note, None)?;
        self.conn.execute(
            "INSERT INTO notes (id, title, title_is_auto, body, created_at, updated_at, \
             last_opened_at, is_pinned, is_archived, is_deleted, deleted_at, content_kind, \
             surface_data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                note.id,
                title,
                i64::from(title_is_auto),
                body,
                note.created_at,
                note.updated_at,
                i64::from(note.is_pinned),
                i64::from(note.is_archived),
                i64::from(note.deleted_at.is_some()),
                note.deleted_at,
                note.kind,
                surface_data
            ],
        )?;
        self.set_vault_edges(&note.id, &body, &note.tags, &note.spaces)
    }

    fn apply_from_vault(&self, note: &VaultNote) -> Result<()> {
        let existing: Option<String> = self.conn.query_row(
            "SELECT surface_data FROM notes WHERE id = ?1",
            params![note.id],
            |r| r.get(0),
        )?;
        let (title, title_is_auto, body, surface_data) =
            self.vault_fields(note, existing.as_deref())?;
        self.conn.execute(
            "UPDATE notes SET title = ?1, title_is_auto = ?2, body = ?3, created_at = ?4, \
             updated_at = ?5, is_pinned = ?6, is_archived = ?7, is_deleted = ?8, \
             deleted_at = ?9, content_kind = ?10, surface_data = ?11 WHERE id = ?12",
            params![
                title,
                i64::from(title_is_auto),
                body,
                note.created_at,
                note.updated_at,
                i64::from(note.is_pinned),
                i64::from(note.is_archived),
                i64::from(note.deleted_at.is_some()),
                note.deleted_at,
                note.kind,
                surface_data,
                note.id
            ],
        )?;
        self.set_vault_edges(&note.id, &body, &note.tags, &note.spaces)
    }

    fn copy_from_vault(&self, source: &VaultNote, loser_sha: &str) -> Result<Option<String>> {
        let id = derived_id(&["conflict", &source.id, loser_sha]);
        let exists = self
            .conn
            .query_row("SELECT 1 FROM notes WHERE id = ?1", params![id], |_| Ok(()))
            .optional()?
            .is_some();
        if exists {
            return Ok(None);
        }
        self.insert_from_vault(&as_conflict(source, id.clone()))?;
        Ok(Some(id))
    }

    fn set_vault_edges(
        &self,
        id: &str,
        body: &str,
        tags: &[String],
        spaces: &[String],
    ) -> Result<()> {
        self.conn
            .execute("DELETE FROM note_tags WHERE note_id = ?1", params![id])?;
        let inline: Vec<String> = domain::extract_inline_tags(body);
        let mut names: Vec<String> = tags
            .iter()
            .filter_map(|t| domain::normalize_tag_name(t))
            .collect();
        names.extend(inline.iter().cloned());
        let mut seen = HashSet::new();
        for name in names {
            if !seen.insert(name.clone()) {
                continue;
            }
            let tag = tag_get_or_create(&self.conn, &name)?;
            let source = if inline.contains(&name) {
                "inline"
            } else {
                "manual"
            };
            attach_tag(&self.conn, id, &tag.id, source)?;
        }
        self.conn.execute(
            "DELETE FROM note_workspaces WHERE note_id = ?1",
            params![id],
        )?;
        for space in spaces {
            let Ok(ws) = workspace_get_or_create(&self.conn, space) else {
                continue;
            };
            self.conn.execute(
                "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
                 VALUES (?1, ?2, ?3)",
                params![id, ws.id, now_iso()],
            )?;
        }
        Ok(())
    }

    fn apply_manifest(&mut self, ours: &Manifest, merged: &Manifest) -> Result<bool> {
        let mut changed = false;
        let now = now_iso();
        for (name, tag) in &merged.tags {
            match self.find_tag(name)? {
                None => {
                    let created = tag_get_or_create(&self.conn, name)?;
                    if tag.color.is_some() {
                        self.conn.execute(
                            "UPDATE tags SET color = ?1, updated_at = ?2 WHERE id = ?3",
                            params![tag.color, now, created.id],
                        )?;
                    }
                    changed = true;
                }
                Some(existing) if existing.color != tag.color => {
                    self.conn.execute(
                        "UPDATE tags SET color = ?1, updated_at = ?2 WHERE id = ?3",
                        params![tag.color, now, existing.id],
                    )?;
                    changed = true;
                }
                Some(_) => {}
            }
        }
        for name in ours.tags.keys().filter(|n| !merged.tags.contains_key(*n)) {
            changed |= self.conn.execute(
                "DELETE FROM tags WHERE name = ?1 \
                 AND NOT EXISTS (SELECT 1 FROM note_tags WHERE tag_id = tags.id)",
                params![name],
            )? > 0;
        }
        let kept: HashSet<String> = merged
            .spaces
            .iter()
            .map(|s| s.name.to_lowercase())
            .collect();
        for space in &merged.spaces {
            if self.find_workspace(&space.name)?.is_none() {
                workspace_get_or_create(&self.conn, &space.name)?;
                changed = true;
            }
        }
        for space in ours
            .spaces
            .iter()
            .filter(|s| !kept.contains(&s.name.to_lowercase()))
        {
            changed |= self.conn.execute(
                "DELETE FROM workspaces WHERE name = ?1 COLLATE NOCASE \
                 AND NOT EXISTS (SELECT 1 FROM note_workspaces WHERE workspace_id = workspaces.id)",
                params![space.name],
            )? > 0;
        }
        Ok(changed)
    }
}
