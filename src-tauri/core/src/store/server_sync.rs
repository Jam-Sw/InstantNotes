use super::vault::MANIFEST_BASE_SETTING;
use super::vault_sync::CONFLICT_TAG;
use super::*;
use crate::attachments::Attachments;
use crate::sync::object::{attachment_key, note_key, sha_hex, Envelope, MANIFEST_KEY, NOTE_PREFIX};
use crate::vault::reconcile::{decide, derived_id, equivalent, Decision, Remote, Side, Synced};
use crate::vault::{
    merge_manifest, parse_manifest, parse_note, serialize_manifest, serialize_note, VaultNote,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub type LegacyNotes = Vec<(String, Option<String>)>;

pub const SYNC_STATE_SETTING: &str = "sync.state";
pub const MERGE_REVIEW_SETTING: &str = "sync.mergeReview";
const LIKELY_MIN_CHARS: usize = 200;
const PREFIX_MIN_CHARS: usize = 20;
const LIKELY_RATIO: f32 = 0.9;
const BUCKET_CHARS: usize = 32;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub library_id: Option<String>,
    pub epoch: i64,
    pub cursor: i64,
    pub joined: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Combined {
    pub kept: String,
    pub trashed: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub a: String,
    pub b: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReview {
    pub combined: Vec<Combined>,
    pub pairs: Vec<Pair>,
}

impl MergeReview {
    pub fn is_empty(&self) -> bool {
        self.combined.is_empty() && self.pairs.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct Arrived {
    pub changed: Vec<String>,
    pub conflict: bool,
    pub inserted: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Pending {
    pub key: String,
    pub base: Option<String>,
    pub plain: Option<Vec<u8>>,
}

pub type JoinCandidates = HashMap<String, Vec<String>>;

fn content_hash(note: &VaultNote) -> String {
    sha_hex(
        format!(
            "{}\0{}\0{}\0{}",
            note.kind,
            note.title.as_deref().unwrap_or(""),
            note.body.replace("\r\n", "\n"),
            note.surface.as_deref().unwrap_or("").replace("\r\n", "\n")
        )
        .as_bytes(),
    )
}

pub fn note_envelope(note: &VaultNote) -> Envelope {
    let md = serialize_note(&VaultNote {
        surface: None,
        ..note.clone()
    });
    Envelope::note(&note.id, md, note.surface.clone())
}

fn bucket(body: &str) -> String {
    body.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .take(BUCKET_CHARS)
        .collect()
}

fn likely_same(a: &str, b: &str) -> Option<&'static str> {
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() || b.is_empty() || a == b {
        return None;
    }
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if short.chars().count() >= PREFIX_MIN_CHARS && long.starts_with(short) {
        return Some("one is an older or longer version of the other");
    }
    if a.chars().count() >= LIKELY_MIN_CHARS
        && b.chars().count() >= LIKELY_MIN_CHARS
        && similar::TextDiff::from_chars(a, b).ratio() >= LIKELY_RATIO
    {
        return Some("almost the same text");
    }
    None
}

impl Store {
    pub fn sync_state(&self) -> Result<SyncState> {
        Ok(self
            .get_setting(SYNC_STATE_SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn set_sync_state(&mut self, state: &SyncState) -> Result<()> {
        self.set_setting(
            SYNC_STATE_SETTING,
            serde_json::to_value(state).unwrap_or_default(),
        )
    }

    pub fn merge_review(&self) -> Result<MergeReview> {
        Ok(self
            .get_setting(MERGE_REVIEW_SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub fn set_merge_review(&self, review: &MergeReview) -> Result<()> {
        if review.is_empty() {
            self.conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                params![MERGE_REVIEW_SETTING],
            )?;
            return Ok(());
        }
        super::settings::setting_put(
            &self.conn,
            MERGE_REVIEW_SETTING,
            &serde_json::to_value(review).unwrap_or_default(),
        )
    }

    pub fn begin_server_sync(&mut self) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM sync_objects", [])?;
        tx.execute("DELETE FROM vault_tombstones", [])?;
        tx.execute(
            "UPDATE notes SET vault_path = NULL, file_sha = NULL, board_sha = NULL, vault_dirty = 1",
            [],
        )?;
        tx.execute(
            "DELETE FROM settings WHERE key IN (?1, ?2)",
            params![SYNC_STATE_SETTING, MANIFEST_BASE_SETTING],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn end_server_sync(&mut self) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM sync_objects", [])?;
        tx.execute(
            "DELETE FROM vault_tombstones WHERE vault_path LIKE 'note:%'",
            [],
        )?;
        tx.execute(
            "UPDATE notes SET vault_path = NULL, file_sha = NULL, board_sha = NULL \
             WHERE vault_path LIKE 'note:%'",
            [],
        )?;
        tx.execute(
            "DELETE FROM settings WHERE key IN (?1, ?2)",
            params![SYNC_STATE_SETTING, MANIFEST_BASE_SETTING],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn forget_sync_bases(&mut self) -> Result<()> {
        self.conn
            .execute("UPDATE sync_objects SET remote_sha = NULL", [])?;
        self.conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            params![MANIFEST_BASE_SETTING],
        )?;
        Ok(())
    }

    pub fn mark_unsent_dirty(&mut self) -> Result<usize> {
        Ok(self.conn.execute(
            "UPDATE notes SET vault_dirty = 1 WHERE vault_path LIKE 'note:%' AND vault_dirty = 0 \
             AND NOT EXISTS (SELECT 1 FROM sync_objects s \
                             WHERE s.key = notes.vault_path AND s.remote_sha IS NOT NULL)",
            [],
        )?)
    }

    pub fn staged_keys_cover(
        &self,
        live_names: &[String],
        staged_keys: &HashSet<String>,
    ) -> Result<Vec<String>> {
        let mut missing = Vec::new();
        for name in live_names {
            match self.sync_object(name)? {
                Some((key, _)) if staged_keys.contains(&key) => {}
                _ => missing.push(name.clone()),
            }
        }
        Ok(missing)
    }

    pub fn sync_object(&self, name: &str) -> Result<Option<(String, Option<String>)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT key, remote_sha FROM sync_objects WHERE name = ?1",
                params![name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    fn remote_sha(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT remote_sha FROM sync_objects WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }

    pub fn record_remote(&self, key: &str, name: &str, remote_sha: Option<&str>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sync_objects (key, name, remote_sha) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET name = excluded.name, remote_sha = excluded.remote_sha",
            params![key, name, remote_sha],
        )?;
        Ok(())
    }

    pub fn synced_note_count(&self) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM notes WHERE vault_path LIKE 'note:%' AND file_sha IS NOT NULL \
             AND is_deleted = 0",
            [],
            |r| r.get::<_, i64>(0),
        )? as usize)
    }

    pub fn join_candidates(&self) -> Result<JoinCandidates> {
        let ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM notes WHERE file_sha IS NULL AND vault_path IS NULL")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut out: JoinCandidates = HashMap::new();
        for id in ids {
            let note = self.vault_note(&id)?;
            out.entry(content_hash(&note)).or_default().push(id);
        }
        Ok(out)
    }

    pub fn ingest_server_note(
        &mut self,
        name: &str,
        remote_sha: &str,
        envelope: &Envelope,
        plain_sha: &str,
        candidates: &mut JoinCandidates,
    ) -> Result<Arrived> {
        let id = envelope
            .note_id()
            .ok_or_else(|| AppError::Validation("not a note object".into()))?;
        let md = envelope
            .md
            .as_deref()
            .ok_or_else(|| AppError::Validation("note object has no text".into()))?;
        let mut note = parse_note(md).map_err(|e| AppError::Validation(e.to_string()))?;
        if note.id != id {
            return Err(AppError::Validation(
                "note object names another note".into(),
            ));
        }
        note.surface = envelope.surface.clone();
        let key = note_key(id);
        let tx = self.conn.unchecked_transaction()?;
        let row = self.vault_row(id)?;
        let local = match &row {
            Some(_) => Some(self.vault_note(id)?),
            None => None,
        };
        let synced = row.as_ref().map(|r| Synced {
            sha: r.sha.as_deref(),
            surface_sha: None,
            dirty: r.dirty,
        });
        let remote = Remote {
            note: &note,
            sha: plain_sha,
            surface_sha: None,
        };
        let tombstoned = self.tombstoned(&key, plain_sha)?;
        let decision = decide(local.as_ref().zip(synced), remote, tombstoned);
        let mut out = Arrived::default();
        let record = |store: &Store, dirty: bool| -> Result<()> {
            let dirty = dirty || !equivalent(&note, &store.vault_note(id)?);
            store.conn.execute(
                "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = NULL, \
                 vault_dirty = ?3 WHERE id = ?4",
                params![key, plain_sha, i64::from(dirty), id],
            )?;
            Ok(())
        };
        match decision {
            Decision::Skip | Decision::Unchanged => {}
            Decision::Same => record(self, false)?,
            Decision::Insert => {
                self.insert_from_vault(&note)?;
                record(self, false)?;
                out.changed.push(id.to_string());
                out.inserted = Some(id.to_string());
                if let Some(local_id) = candidates
                    .get_mut(&content_hash(&note))
                    .and_then(|ids| ids.pop())
                {
                    self.combine_into(&local_id, id)?;
                    out.changed.push(local_id);
                }
            }
            Decision::Take => {
                self.apply_from_vault(&note)?;
                record(self, false)?;
                out.changed.push(id.to_string());
            }
            Decision::Fork(Side::Local) => {
                if let Some(copy) = self.copy_from_vault(&note, plain_sha)? {
                    out.conflict = true;
                    self.note_review_pair(id, &copy, "changed in two places")?;
                    out.changed.push(copy);
                }
                self.conn.execute(
                    "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = NULL, \
                     vault_dirty = 1 WHERE id = ?3",
                    params![key, plain_sha, id],
                )?;
            }
            Decision::Fork(Side::Remote) => {
                let mine = local.as_ref().expect("a fork has a local side");
                let mine_sha = sha_hex(&note_envelope(mine).encode());
                if let Some(copy) = self.copy_from_vault(mine, &mine_sha)? {
                    out.conflict = true;
                    self.note_review_pair(id, &copy, "changed in two places")?;
                    out.changed.push(copy);
                }
                self.apply_from_vault(&note)?;
                record(self, false)?;
                out.changed.push(id.to_string());
            }
        }
        self.record_remote(&key, name, Some(remote_sha))?;
        tx.commit()?;
        Ok(out)
    }

    fn combine_into(&self, local_id: &str, kept_id: &str) -> Result<()> {
        let local = self.vault_note(local_id)?;
        let kept = self.vault_note(kept_id)?;
        let mut tags = kept.tags.clone();
        tags.extend(local.tags.iter().cloned());
        let mut spaces = kept.spaces.clone();
        spaces.extend(local.spaces.iter().cloned());
        let merged = VaultNote {
            tags,
            spaces,
            is_pinned: kept.is_pinned || local.is_pinned,
            is_archived: kept.is_archived && local.is_archived,
            ..kept.clone()
        };
        if !equivalent(&merged, &kept) {
            self.apply_from_vault(&merged)?;
        }
        self.conn.execute(
            "UPDATE notes SET last_opened_at = \
               max(coalesce(last_opened_at, ''), \
                   coalesce((SELECT last_opened_at FROM notes WHERE id = ?2), '')) \
             WHERE id = ?1",
            params![kept_id, local_id],
        )?;
        self.conn.execute(
            "UPDATE notes SET is_deleted = 1, deleted_at = ?2, vault_dirty = 0 WHERE id = ?1",
            params![local_id, now_iso()],
        )?;
        let mut review = self.merge_review()?;
        review.combined.push(Combined {
            kept: kept_id.to_string(),
            trashed: local_id.to_string(),
        });
        self.set_merge_review(&review)
    }

    fn note_review_pair(&self, a: &str, b: &str, reason: &str) -> Result<()> {
        if !self.sync_state()?.joined {
            let mut review = self.merge_review()?;
            review.pairs.push(Pair {
                a: a.to_string(),
                b: b.to_string(),
                reason: reason.to_string(),
            });
            self.set_merge_review(&review)?;
        }
        Ok(())
    }

    pub fn find_likely_pairs(&mut self, arrived: &[String]) -> Result<usize> {
        if arrived.is_empty() {
            return Ok(0);
        }
        let arrived: HashSet<&String> = arrived.iter().collect();
        let locals: Vec<(String, String, String)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, body, content_kind FROM notes \
                 WHERE vault_path IS NULL AND file_sha IS NULL AND is_deleted = 0",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut buckets: HashMap<(String, String), Vec<(String, String)>> = HashMap::new();
        for (id, body, kind) in locals {
            buckets
                .entry((kind, bucket(&body)))
                .or_default()
                .push((id, body));
        }
        let mut found = Vec::new();
        for id in arrived {
            let note = self.fetch_note(id)?;
            let Some(peers) = buckets.get(&(note.content_kind.clone(), bucket(&note.body))) else {
                continue;
            };
            for (peer, body) in peers {
                if let Some(reason) = likely_same(&note.body, body) {
                    found.push(Pair {
                        a: id.clone(),
                        b: peer.clone(),
                        reason: reason.to_string(),
                    });
                }
            }
        }
        let count = found.len();
        if count > 0 {
            let mut review = self.merge_review()?;
            review.pairs.extend(found);
            self.set_merge_review(&review)?;
        }
        Ok(count)
    }

    pub fn ingest_server_deletion(&mut self, key: &str, held: bool) -> Result<Option<String>> {
        let tx = self.conn.unchecked_transaction()?;
        let mut trashed = None;
        if let Some(id) = key.strip_prefix(NOTE_PREFIX) {
            if let Some(row) = self.vault_row(id)? {
                if row.dirty {
                    self.conn.execute(
                        "UPDATE sync_objects SET remote_sha = NULL WHERE key = ?1",
                        params![key],
                    )?;
                    tx.commit()?;
                    return Ok(None);
                }
                if held {
                    return Ok(None);
                }
                let deleted: bool = self.conn.query_row(
                    "SELECT is_deleted FROM notes WHERE id = ?1",
                    params![id],
                    |r| Ok(r.get::<_, i64>(0)? != 0),
                )?;
                if !deleted {
                    self.conn.execute(
                        "UPDATE notes SET is_deleted = 1, deleted_at = ?1 WHERE id = ?2",
                        params![now_iso(), id],
                    )?;
                    trashed = Some(id.to_string());
                }
                self.conn.execute(
                    "UPDATE notes SET vault_path = NULL, file_sha = NULL, vault_dirty = 0 \
                     WHERE id = ?1",
                    params![id],
                )?;
            }
        }
        self.conn
            .execute("DELETE FROM sync_objects WHERE key = ?1", params![key])?;
        tx.commit()?;
        Ok(trashed)
    }

    pub fn ingest_server_manifest(
        &mut self,
        name: &str,
        remote_sha: &str,
        theirs_text: &str,
    ) -> Result<bool> {
        let theirs = parse_manifest(theirs_text)
            .map_err(|e| AppError::Validation(format!("manifest cannot be read: {e}")))?;
        let base = self
            .get_setting(MANIFEST_BASE_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string))
            .and_then(|t| parse_manifest(&t).ok());
        let ours = self.vault_manifest()?;
        let merged = merge_manifest(base.as_ref(), &ours, &theirs);
        let changed = self.apply_manifest(&ours, &merged)?;
        self.set_setting(
            MANIFEST_BASE_SETTING,
            serde_json::Value::String(theirs_text.to_string()),
        )?;
        self.record_remote(MANIFEST_KEY, name, Some(remote_sha))?;
        Ok(changed)
    }

    pub fn ingest_server_attachment(
        &mut self,
        name: &str,
        remote_sha: &str,
        file: &str,
        bytes: &[u8],
        place: Option<&Attachments>,
    ) -> Result<bool> {
        let written = match place {
            Some(Attachments::Folder(dir)) => {
                let path = dir.join(file);
                let missing = std::fs::symlink_metadata(&path).is_err();
                if missing {
                    std::fs::create_dir_all(dir).map_err(|e| {
                        AppError::Storage(format!("cannot create attachments: {e}"))
                    })?;
                    crate::vault::atomic_write(&path, bytes)
                        .map_err(|e| AppError::Storage(format!("cannot write attachment: {e}")))?;
                }
                missing
            }
            Some(Attachments::Database) => self.save_attachment_file(file, bytes)?,
            None => false,
        };
        self.record_remote(&attachment_key(file), name, Some(remote_sha))?;
        Ok(written)
    }

    pub fn export_legacy(&self) -> Result<(LegacyNotes, String)> {
        let ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM notes ORDER BY created_at, id")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut notes = Vec::with_capacity(ids.len());
        for id in ids {
            let note = self.vault_note(&id)?;
            notes.push((serialize_note(&note), note.surface.clone()));
        }
        Ok((notes, serialize_manifest(&self.vault_manifest()?)))
    }

    pub fn import_legacy(
        &mut self,
        notes: &[(String, Option<String>)],
        manifest: Option<&str>,
    ) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut added = 0;
        for (md, surface) in notes {
            let mut note = parse_note(md).map_err(|e| AppError::Validation(e.to_string()))?;
            note.surface = surface.clone();
            if self.vault_row(&note.id)?.is_some() {
                if equivalent(&self.vault_note(&note.id)?, &note) {
                    continue;
                }
                note.id = derived_id(&["legacy", &note.id]);
                note.tags.push(CONFLICT_TAG.to_string());
                if self.vault_row(&note.id)?.is_some() {
                    continue;
                }
            }
            self.insert_from_vault(&note)?;
            self.conn.execute(
                "UPDATE notes SET vault_dirty = 1 WHERE id = ?1",
                params![note.id],
            )?;
            added += 1;
        }
        tx.commit()?;
        if let Some(text) = manifest {
            let theirs = parse_manifest(text)
                .map_err(|e| AppError::Validation(format!("manifest cannot be read: {e}")))?;
            let ours = self.vault_manifest()?;
            let merged = merge_manifest(None, &ours, &theirs);
            self.apply_manifest(&ours, &merged)?;
        }
        Ok(added)
    }

    pub fn save_attachment_file(&mut self, file: &str, bytes: &[u8]) -> Result<bool> {
        let added = self.conn.execute(
            "INSERT OR IGNORE INTO attachment_files (name, bytes, created_at) VALUES (?1, ?2, ?3)",
            params![file, bytes, now_ms()],
        )?;
        Ok(added > 0)
    }

    pub fn attachment_file(&self, file: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row(
                "SELECT bytes FROM attachment_files WHERE name = ?1",
                params![file],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn attachment_file_sizes(&self, made_before_ms: Option<i64>) -> Result<Vec<(String, u64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT name, length(bytes) FROM attachment_files WHERE created_at < ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![made_before_ms.unwrap_or(i64::MAX)], |r| {
            Ok((r.get(0)?, r.get::<_, i64>(1)? as u64))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn delete_attachment_file(&self, file: &str) -> Result<Option<u64>> {
        Ok(self
            .conn
            .query_row(
                "DELETE FROM attachment_files WHERE name = ?1 RETURNING length(bytes)",
                params![file],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .map(|n| n as u64))
    }

    fn attachment_names(&self, place: &Attachments) -> Result<Vec<String>> {
        match place {
            Attachments::Folder(dir) => Ok(crate::attachments::list_attachments(dir, None)
                .map_err(|e| AppError::Storage(format!("cannot list attachments: {e}")))?
                .into_iter()
                .map(|(name, _)| name)
                .collect()),
            Attachments::Database => {
                let mut stmt = self
                    .conn
                    .prepare("SELECT name FROM attachment_files ORDER BY name")?;
                let rows = stmt.query_map([], |r| r.get(0))?;
                Ok(rows.collect::<rusqlite::Result<_>>()?)
            }
        }
    }

    fn attachment_bytes(&self, place: &Attachments, file: &str) -> Result<Vec<u8>> {
        match place {
            Attachments::Folder(dir) => std::fs::read(dir.join(file))
                .map_err(|e| AppError::Storage(format!("cannot read attachment: {e}"))),
            Attachments::Database => self
                .attachment_file(file)?
                .ok_or_else(|| AppError::Storage(format!("attachment {file} is missing"))),
        }
    }

    pub fn pending_server_pushes(
        &mut self,
        attachments: Option<&Attachments>,
    ) -> Result<Vec<Pending>> {
        let mut out = Vec::new();
        let dirty: Vec<(String, Option<String>)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, file_sha FROM notes WHERE vault_dirty = 1")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, base_plain) in dirty {
            let key = note_key(&id);
            let plain = note_envelope(&self.vault_note(&id)?).encode();
            let remote = self.remote_sha(&key)?;
            if remote.is_some() && base_plain.as_deref() == Some(sha_hex(&plain).as_str()) {
                self.conn.execute(
                    "UPDATE notes SET vault_dirty = 0 WHERE id = ?1",
                    params![id],
                )?;
                continue;
            }
            out.push(Pending {
                key,
                base: remote,
                plain: Some(plain),
            });
        }
        let tombstones: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT vault_path FROM vault_tombstones WHERE vault_path LIKE 'note:%'",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for key in tombstones {
            match self.remote_sha(&key)? {
                Some(remote) => out.push(Pending {
                    key,
                    base: Some(remote),
                    plain: None,
                }),
                None => {
                    self.conn.execute(
                        "DELETE FROM vault_tombstones WHERE vault_path = ?1",
                        params![key],
                    )?;
                }
            }
        }
        let manifest = serialize_manifest(&self.vault_manifest()?);
        let base = self
            .get_setting(MANIFEST_BASE_SETTING)?
            .and_then(|v| v.as_str().map(str::to_string));
        if base.as_deref() != Some(manifest.as_str()) {
            out.push(Pending {
                key: MANIFEST_KEY.to_string(),
                base: self.remote_sha(MANIFEST_KEY)?,
                plain: Some(Envelope::manifest(manifest).encode()),
            });
        }
        if let Some(place) = attachments {
            for file in self.attachment_names(place)? {
                let key = attachment_key(&file);
                let known: bool = self
                    .conn
                    .query_row(
                        "SELECT 1 FROM sync_objects WHERE key = ?1 AND remote_sha IS NOT NULL",
                        params![key],
                        |_| Ok(()),
                    )
                    .optional()?
                    .is_some();
                if known {
                    continue;
                }
                let bytes = self.attachment_bytes(place, &file)?;
                out.push(Pending {
                    key,
                    base: None,
                    plain: Some(Envelope::attachment(&file, &bytes).encode()),
                });
            }
        }
        Ok(out)
    }

    pub fn server_pushed(
        &mut self,
        pending: &Pending,
        name: &str,
        remote_sha: Option<&str>,
    ) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        match (&pending.plain, pending.key.strip_prefix(NOTE_PREFIX)) {
            (None, _) => {
                self.conn.execute(
                    "DELETE FROM vault_tombstones WHERE vault_path = ?1",
                    params![pending.key],
                )?;
                self.conn.execute(
                    "DELETE FROM sync_objects WHERE key = ?1",
                    params![pending.key],
                )?;
            }
            (Some(plain), Some(id)) => {
                let pushed = sha_hex(plain);
                let now = sha_hex(&note_envelope(&self.vault_note(id)?).encode());
                self.conn.execute(
                    "UPDATE notes SET vault_path = ?1, file_sha = ?2, board_sha = NULL, \
                     vault_dirty = ?3 WHERE id = ?4",
                    params![pending.key, pushed, i64::from(now != pushed), id],
                )?;
                self.record_remote(&pending.key, name, remote_sha)?;
            }
            (Some(plain), None) => {
                if pending.key == MANIFEST_KEY {
                    if let Some(text) = Envelope::decode(plain).and_then(|e| e.manifest) {
                        super::settings::setting_put(
                            &self.conn,
                            MANIFEST_BASE_SETTING,
                            &serde_json::Value::String(text),
                        )?;
                    }
                }
                self.record_remote(&pending.key, name, remote_sha)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn all_server_objects(&self, attachments: Option<&Attachments>) -> Result<Vec<Pending>> {
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM notes WHERE vault_path LIKE 'note:%' OR vault_dirty = 1",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut out = Vec::with_capacity(ids.len() + 1);
        for id in ids {
            out.push(Pending {
                key: note_key(&id),
                base: None,
                plain: Some(note_envelope(&self.vault_note(&id)?).encode()),
            });
        }
        out.push(Pending {
            key: MANIFEST_KEY.to_string(),
            base: None,
            plain: Some(Envelope::manifest(serialize_manifest(&self.vault_manifest()?)).encode()),
        });
        if let Some(place) = attachments {
            for file in self.attachment_names(place)? {
                let bytes = self.attachment_bytes(place, &file)?;
                out.push(Pending {
                    key: attachment_key(&file),
                    base: None,
                    plain: Some(Envelope::attachment(&file, &bytes).encode()),
                });
            }
        }
        Ok(out)
    }

    pub fn undo_combine(&mut self, trashed: &str) -> Result<()> {
        let mut review = self.merge_review()?;
        let before = review.combined.len();
        review.combined.retain(|c| c.trashed != trashed);
        if review.combined.len() == before {
            return Err(AppError::NotFound(format!("combined note {trashed}")));
        }
        self.conn.execute(
            "UPDATE notes SET is_deleted = 0, deleted_at = NULL WHERE id = ?1",
            params![trashed],
        )?;
        self.set_merge_review(&review)
    }

    pub fn settle_pair(&mut self, a: &str, b: &str, keep: Option<&str>) -> Result<()> {
        let mut review = self.merge_review()?;
        let before = review.pairs.len();
        review
            .pairs
            .retain(|p| !((p.a == a && p.b == b) || (p.a == b && p.b == a)));
        if review.pairs.len() == before {
            return Err(AppError::NotFound("review pair".into()));
        }
        if let Some(keep) = keep {
            let drop = if keep == a { b } else { a };
            self.conn.execute(
                "UPDATE notes SET is_deleted = 1, deleted_at = ?2 WHERE id = ?1",
                params![drop, now_iso()],
            )?;
        }
        self.set_merge_review(&review)
    }

    pub fn clear_review(&mut self) -> Result<()> {
        self.delete_setting(MERGE_REVIEW_SETTING)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn likely_same_needs_a_shared_start_or_long_near_identical_text() {
        assert!(likely_same(
            "Groceries for the week: milk, eggs",
            "Groceries for the week: milk, eggs, bread"
        )
        .is_some());
        assert!(likely_same("Untitled", "Untitled 2").is_none());
        assert!(likely_same("Idea: X", "Idea: Y").is_none());
        assert!(likely_same("same", "same").is_none());
        let long = "word ".repeat(60);
        let edited = format!("{long}extra");
        assert!(likely_same(&long, &edited).is_some());
        let other = "other ".repeat(60);
        assert!(likely_same(&long, &other).is_none());
    }

    #[test]
    fn identical_content_hashes_alike_whatever_the_line_endings() {
        let note = |body: &str| VaultNote {
            id: "x".into(),
            title: Some("T".into()),
            body: body.into(),
            created_at: "c".into(),
            updated_at: "u".into(),
            is_pinned: false,
            is_archived: false,
            deleted_at: None,
            tags: vec![],
            spaces: vec![],
            kind: "document".into(),
            surface: None,
        };
        assert_eq!(content_hash(&note("a\r\nb")), content_hash(&note("a\nb")));
        assert_ne!(content_hash(&note("a")), content_hash(&note("b")));
    }
}
