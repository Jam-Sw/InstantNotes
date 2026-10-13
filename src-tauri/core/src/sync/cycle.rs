use super::crypto::Lock;
use super::object::{sha_hex, Envelope, MANIFEST_KEY, NOTE_PREFIX};
use super::remote::{Remote, RemoteChange, RemoteError, RemoteOp};
use crate::store::server_sync::{Pending, SyncState};
use crate::vault::StoreLock;
use std::collections::BTreeMap;
use std::path::PathBuf;

const MASS_REMOVAL_FLOOR: usize = 20;
const UPLOAD_BATCH: usize = 1000;
const COMMIT_BATCH: usize = 5000;
const SWITCH_TRIES: usize = 3;

#[derive(Debug, Default)]
pub struct SyncReport {
    pub notes: Vec<String>,
    pub labels_changed: bool,
    pub conflicts: usize,
    pub held_removals: usize,
    pub pushed: usize,
    pub errors: Vec<String>,
    pub unreachable: Option<String>,
    pub signed_out: bool,
    pub mode_changed: bool,
    pub retry: bool,
}

impl SyncReport {
    pub fn reached(&self) -> bool {
        self.unreachable.is_none() && !self.signed_out
    }
}

struct Sealed {
    pending: Pending,
    name: String,
    bytes: Option<Vec<u8>>,
    sha: Option<String>,
}

pub struct ServerSync<R: Remote> {
    pub remote: R,
    lock: Lock,
    attachments: Option<PathBuf>,
    allow_removals: bool,
}

fn unavailable() -> RemoteError {
    RemoteError::Refused("the library is unavailable".into())
}

fn store_error(e: crate::error::AppError) -> RemoteError {
    RemoteError::Refused(e.to_string())
}

fn with<T>(
    store: &impl StoreLock,
    f: impl FnOnce(&mut crate::Store) -> crate::error::Result<T>,
) -> Result<T, RemoteError> {
    store
        .locked(f)
        .ok_or_else(unavailable)?
        .map_err(store_error)
}

impl<R: Remote> ServerSync<R> {
    pub fn new(remote: R, lock: Lock, attachments: Option<PathBuf>) -> ServerSync<R> {
        ServerSync {
            remote,
            lock,
            attachments,
            allow_removals: false,
        }
    }

    pub fn lock(&self) -> &Lock {
        &self.lock
    }

    pub fn confirm_removals(&mut self) {
        self.allow_removals = true;
    }

    pub fn cycle(&mut self, store: &impl StoreLock) -> SyncReport {
        let mut report = SyncReport::default();
        let outcome = self
            .pull(store, &mut report)
            .and_then(|()| match report.mode_changed {
                true => Ok(()),
                false => self.push(store, &mut report),
            });
        if let Err(e) = outcome {
            match e {
                RemoteError::Unreachable(why) => report.unreachable = Some(why),
                RemoteError::SignedOut => report.signed_out = true,
                RemoteError::Conflict(_) => report.retry = true,
                RemoteError::WrongEpoch => report.mode_changed = true,
                RemoteError::Gone => report.retry = true,
                RemoteError::Refused(why) => report.errors.push(why),
            }
        }
        report.notes.sort();
        report.notes.dedup();
        report
    }

    fn pull(&mut self, store: &impl StoreLock, report: &mut SyncReport) -> Result<(), RemoteError> {
        let mut state = with(store, |s| s.sync_state())?;
        let mut since = state.cursor;
        let mut changes: Vec<RemoteChange> = Vec::new();
        let head = loop {
            let page = match self.remote.changes(since) {
                Err(RemoteError::Gone) => {
                    self.reset(store, &mut state, None, None)?;
                    changes.clear();
                    since = 0;
                    continue;
                }
                other => other?,
            };
            let same_library = state.library_id.as_deref() == Some(page.library_id.as_str());
            if state.library_id.is_some() && !same_library {
                self.reset(
                    store,
                    &mut state,
                    Some(page.library_id.clone()),
                    Some(page.epoch),
                )?;
                changes.clear();
                since = 0;
                continue;
            }
            if state.library_id.is_some() && page.epoch != state.epoch {
                self.reset(store, &mut state, Some(page.library_id), Some(page.epoch))?;
                report.mode_changed = true;
                return Ok(());
            }
            state.library_id = Some(page.library_id.clone());
            state.epoch = page.epoch;
            since = page
                .changes
                .last()
                .map(|c| c.seq)
                .unwrap_or(since)
                .max(since);
            changes.extend(page.changes);
            if !page.more {
                break page.head;
            }
        };
        let mut latest: BTreeMap<String, RemoteChange> = BTreeMap::new();
        for change in changes {
            latest.insert(change.name.clone(), change);
        }
        let deletions: Vec<(String, String)> = {
            let mut out = Vec::new();
            for change in latest.values().filter(|c| c.sha.is_none()) {
                if let Some((key, _)) = with(store, |s| s.sync_object(&change.name))? {
                    if key.starts_with(NOTE_PREFIX) {
                        out.push((change.name.clone(), key));
                    }
                }
            }
            out
        };
        let known = with(store, |s| s.synced_note_count())?;
        let held = deletions.len() > MASS_REMOVAL_FLOOR
            && deletions.len() * 2 > known
            && !self.allow_removals;
        if held {
            report.held_removals = deletions.len();
        } else {
            self.allow_removals = false;
        }
        let mut candidates = if state.joined {
            Default::default()
        } else {
            with(store, |s| s.join_candidates())?
        };
        let mut inserted = Vec::new();
        for change in latest.values() {
            let Some(sha) = &change.sha else {
                if held {
                    continue;
                }
                if let Some((key, _)) = with(store, |s| s.sync_object(&change.name))? {
                    if let Some(id) = with(store, |s| s.ingest_server_deletion(&key))? {
                        report.notes.push(id);
                    }
                }
                continue;
            };
            let known = with(store, |s| s.sync_object(&change.name))?;
            if known.as_ref().and_then(|(_, r)| r.as_deref()) == Some(sha.as_str()) {
                continue;
            }
            let sealed = self.remote.download(sha)?;
            if sha_hex(&sealed) != *sha {
                report
                    .errors
                    .push(format!("object {} arrived damaged", &change.name[..8]));
                continue;
            }
            let Ok(plain) = self.lock.open(&sealed) else {
                report.errors.push(format!(
                    "object {} cannot be decrypted with this key",
                    &change.name[..8]
                ));
                continue;
            };
            let Some(envelope) = Envelope::decode(&plain) else {
                report
                    .errors
                    .push(format!("object {} is not readable", &change.name[..8]));
                continue;
            };
            if self.lock.name(&envelope.key) != change.name {
                report.errors.push(format!(
                    "object {} is stored under the wrong name",
                    &change.name[..8]
                ));
                continue;
            }
            let plain_sha = sha_hex(&plain);
            let name = change.name.clone();
            if envelope.note_id().is_some() {
                let arrived = with(store, |s| {
                    s.ingest_server_note(&name, sha, &envelope, &plain_sha, &mut candidates)
                });
                match arrived {
                    Ok(arrived) => {
                        report.labels_changed |= !arrived.changed.is_empty();
                        report.conflicts += usize::from(arrived.conflict);
                        report.notes.extend(arrived.changed);
                        inserted.extend(arrived.inserted);
                    }
                    Err(e) => report.errors.push(e.to_string()),
                }
            } else if envelope.key == MANIFEST_KEY {
                let text = envelope.manifest.clone().unwrap_or_default();
                match with(store, |s| s.ingest_server_manifest(&name, sha, &text)) {
                    Ok(changed) => report.labels_changed |= changed,
                    Err(e) => report.errors.push(e.to_string()),
                }
            } else if let (Some(file), Some(bytes)) =
                (envelope.attachment_file(), envelope.attachment_bytes())
            {
                let dir = self.attachments.clone();
                if let Err(e) = with(store, |s| {
                    s.ingest_server_attachment(&name, sha, file, &bytes, dir.as_deref())
                }) {
                    report.errors.push(e.to_string());
                }
            }
        }
        if !state.joined {
            with(store, |s| s.find_likely_pairs(&inserted))?;
        }
        if !held {
            state.cursor = head;
        }
        with(store, |s| s.set_sync_state(&state))?;
        Ok(())
    }

    fn reset(
        &self,
        store: &impl StoreLock,
        state: &mut SyncState,
        library_id: Option<String>,
        epoch: Option<i64>,
    ) -> Result<(), RemoteError> {
        state.cursor = 0;
        state.library_id = library_id;
        if let Some(epoch) = epoch {
            state.epoch = epoch;
        }
        let saved = state.clone();
        with(store, |s| {
            s.forget_sync_bases()?;
            s.set_sync_state(&saved)
        })
    }

    fn seal(&self, pending: Vec<Pending>) -> Vec<Sealed> {
        pending
            .into_iter()
            .map(|p| {
                let bytes = p.plain.as_deref().map(|plain| self.lock.seal(plain));
                Sealed {
                    name: self.lock.name(&p.key),
                    sha: bytes.as_deref().map(sha_hex),
                    bytes,
                    pending: p,
                }
            })
            .collect()
    }

    fn upload(&mut self, sealed: &[Sealed]) -> Result<(), RemoteError> {
        let with_bytes: Vec<&Sealed> = sealed.iter().filter(|s| s.bytes.is_some()).collect();
        for batch in with_bytes.chunks(UPLOAD_BATCH) {
            let shas: Vec<String> = batch.iter().filter_map(|s| s.sha.clone()).collect();
            let missing = self.remote.missing(&shas)?;
            for s in batch {
                if let (Some(sha), Some(bytes)) = (&s.sha, &s.bytes) {
                    if missing.contains(sha) {
                        self.remote.upload(sha, bytes)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn push(&mut self, store: &impl StoreLock, report: &mut SyncReport) -> Result<(), RemoteError> {
        let dir = self.attachments.clone();
        let pending = with(store, |s| s.pending_server_pushes(dir.as_deref()))?;
        let mut state = with(store, |s| s.sync_state())?;
        if !pending.is_empty() {
            let sealed = self.seal(pending);
            self.upload(&sealed)?;
            for batch in sealed.chunks(COMMIT_BATCH) {
                let ops: Vec<RemoteOp> = batch
                    .iter()
                    .map(|s| RemoteOp {
                        name: s.name.clone(),
                        base: s.pending.base.clone(),
                        sha: s.sha.clone(),
                    })
                    .collect();
                self.remote.commit(state.epoch, &ops)?;
                for s in batch {
                    with(store, |st| {
                        st.server_pushed(&s.pending, &s.name, s.sha.as_deref())
                    })?;
                }
                report.pushed += batch.len();
            }
        }
        if !state.joined {
            state.joined = true;
            with(store, |s| s.set_sync_state(&state))?;
        }
        Ok(())
    }

    pub fn switch_mode(
        &mut self,
        store: &impl StoreLock,
        lock: Lock,
        mode: &str,
        recipient: Option<&str>,
    ) -> Result<i64, RemoteError> {
        let mut tries = 0;
        let mut next = lock;
        loop {
            tries += 1;
            let mut report = SyncReport::default();
            self.pull(store, &mut report)?;
            self.push(store, &mut report)?;
            self.pull(store, &mut report)?;
            let state = with(store, |s| s.sync_state())?;
            let dir = self.attachments.clone();
            let everything = with(store, |s| s.all_server_objects(dir.as_deref()))?;
            let previous = std::mem::replace(&mut self.lock, next);
            let sealed = self.seal(everything);
            let staged = self.upload(&sealed).and_then(|()| {
                for batch in sealed.chunks(COMMIT_BATCH) {
                    let ops: Vec<RemoteOp> = batch
                        .iter()
                        .map(|s| RemoteOp {
                            name: s.name.clone(),
                            base: None,
                            sha: s.sha.clone(),
                        })
                        .collect();
                    self.remote.commit(state.epoch + 1, &ops)?;
                }
                self.remote
                    .switch(state.epoch, state.cursor, mode, recipient)
            });
            match staged {
                Ok(epoch) => {
                    let saved = SyncState {
                        library_id: state.library_id.clone(),
                        epoch,
                        cursor: 0,
                        joined: true,
                    };
                    with(store, |s| {
                        s.forget_sync_bases()?;
                        for item in &sealed {
                            s.server_pushed(&item.pending, &item.name, item.sha.as_deref())?;
                        }
                        s.set_sync_state(&saved)
                    })?;
                    return Ok(epoch);
                }
                Err(RemoteError::Conflict(_)) | Err(RemoteError::WrongEpoch)
                    if tries < SWITCH_TRIES =>
                {
                    next = std::mem::replace(&mut self.lock, previous);
                }
                Err(e) => {
                    self.lock = previous;
                    return Err(e);
                }
            }
        }
    }
}
