use super::crypto::{LibraryKey, Lock};
use super::object::{plain_proof_text, sha_hex, Envelope, MANIFEST_KEY, MODE_KEY, NOTE_PREFIX};
use super::remote::{Remote, RemoteChange, RemoteChanges, RemoteError, RemoteKeys, RemoteOp};
use crate::store::server_sync::{JoinCandidates, Pending, SyncState};
use crate::vault::StoreLock;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

const MASS_REMOVAL_FLOOR: usize = 20;
const DOWNLOAD_BATCH: usize = 200;
const PUSH_BATCH: usize = 500;
const SWITCH_TRIES: usize = 3;
pub const PLAIN: &str = "plain";
pub const ENCRYPTED: &str = "encrypted";

#[derive(Debug, Default)]
pub struct SyncReport {
    pub notes: Vec<String>,
    pub labels_changed: bool,
    pub conflicts: usize,
    pub held_removals: usize,
    pub pushed: usize,
    pub too_large: Vec<String>,
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

#[derive(Debug, PartialEq, Eq)]
pub enum ModeCheck {
    Unset,
    Encrypted,
    Plain,
    NeedsKey,
    Refuse(String),
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

fn short(name: &str) -> &str {
    &name[..name.len().min(8)]
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

    fn everything(&mut self) -> Result<RemoteChanges, RemoteError> {
        let mut all = self.remote.changes(0)?;
        while all.more {
            let since = all.changes.last().map(|c| c.seq).unwrap_or(0);
            let page = self.remote.changes(since)?;
            all.more = page.more;
            all.head = page.head;
            all.changes.extend(page.changes);
        }
        Ok(all)
    }

    pub fn check_mode(
        &mut self,
        keys: &RemoteKeys,
        key: Option<&LibraryKey>,
        known_epoch: i64,
    ) -> Result<ModeCheck, RemoteError> {
        if keys.epoch < known_epoch {
            return Ok(ModeCheck::Refuse(
                "the server went back to an older form of this library".into(),
            ));
        }
        match (keys.mode.as_deref(), key) {
            (None, _) => Ok(ModeCheck::Unset),
            (Some(ENCRYPTED), None) => Ok(ModeCheck::NeedsKey),
            (Some(ENCRYPTED), Some(key)) => match keys.recipient.as_deref() {
                Some(r) if r == key.recipient() => Ok(ModeCheck::Encrypted),
                _ => Ok(ModeCheck::Refuse(
                    "the server names a different encryption key than this device holds".into(),
                )),
            },
            (Some(PLAIN), None) => Ok(ModeCheck::Plain),
            (Some(PLAIN), Some(key)) => {
                let all = self.everything()?;
                let name = Lock::Plain.name(MODE_KEY);
                let marker = all
                    .changes
                    .iter()
                    .rev()
                    .find(|c| c.name == name)
                    .and_then(|c| c.sha.clone());
                let proven = match marker {
                    Some(sha) => self
                        .remote
                        .download(std::slice::from_ref(&sha))?
                        .into_iter()
                        .find(|(s, _)| *s == sha)
                        .and_then(|(_, bytes)| Envelope::decode(&bytes))
                        .and_then(|e| e.proof)
                        .is_some_and(|proof| {
                            key.verify(&plain_proof_text(&all.library_id, all.epoch), &proof)
                        }),
                    None => false,
                };
                Ok(match proven && all.epoch >= known_epoch {
                    true => ModeCheck::Plain,
                    false => ModeCheck::Refuse(
                        "the server says encryption was turned off, but no device holding the key turned it off"
                            .into(),
                    ),
                })
            }
            (Some(other), _) => Ok(ModeCheck::Refuse(format!("unknown server mode {other}"))),
        }
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
        let mut reset = false;
        let mut changes: Vec<RemoteChange> = Vec::new();
        let head = loop {
            let page = match self.remote.changes(since) {
                Err(RemoteError::Gone) => {
                    let id = state.library_id.clone();
                    self.reset(store, &mut state, id, None)?;
                    reset = true;
                    changes.clear();
                    since = 0;
                    continue;
                }
                other => other?,
            };
            let known = state.library_id.is_some();
            let same_library = state.library_id.as_deref() == Some(page.library_id.as_str());
            if known && !same_library {
                self.reset(
                    store,
                    &mut state,
                    Some(page.library_id.clone()),
                    Some(page.epoch),
                )?;
                reset = true;
                changes.clear();
                since = 0;
                continue;
            }
            if known && page.epoch < state.epoch {
                return Err(RemoteError::Refused(
                    "the server went back to an older form of this library".into(),
                ));
            }
            if known && page.epoch > state.epoch {
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
        let mut deletions = 0;
        let mut wanted: Vec<RemoteChange> = Vec::new();
        for change in latest.values() {
            let known = with(store, |s| s.sync_object(&change.name))?;
            match &change.sha {
                None => {
                    if known.is_some_and(|(key, _)| key.starts_with(NOTE_PREFIX)) {
                        deletions += 1;
                    }
                }
                Some(sha) => {
                    if known.as_ref().and_then(|(_, r)| r.as_deref()) != Some(sha.as_str()) {
                        wanted.push(change.clone());
                    }
                }
            }
        }
        let known_notes = with(store, |s| s.synced_note_count())?;
        let held =
            deletions > MASS_REMOVAL_FLOOR && deletions * 2 > known_notes && !self.allow_removals;
        if held {
            report.held_removals = deletions;
        } else {
            self.allow_removals = false;
        }
        let mut candidates = if state.joined {
            Default::default()
        } else {
            with(store, |s| s.join_candidates())?
        };
        let mut inserted = Vec::new();
        let mut failed: Option<i64> = None;
        for batch in wanted.chunks(DOWNLOAD_BATCH) {
            let shas: Vec<String> = batch.iter().filter_map(|c| c.sha.clone()).collect();
            let fetched: HashMap<String, Vec<u8>> =
                self.remote.download(&shas)?.into_iter().collect();
            for change in batch {
                let sha = change.sha.clone().unwrap_or_default();
                let applied = match fetched.get(&sha) {
                    Some(sealed) => self.apply(
                        store,
                        report,
                        &change.name,
                        &sha,
                        sealed,
                        &mut candidates,
                        &mut inserted,
                    )?,
                    None => {
                        report
                            .errors
                            .push(format!("object {} was not sent", short(&change.name)));
                        false
                    }
                };
                if !applied {
                    failed = Some(failed.map_or(change.seq, |f| f.min(change.seq)));
                }
            }
        }
        for change in latest.values().filter(|c| c.sha.is_none()) {
            if let Some((key, _)) = with(store, |s| s.sync_object(&change.name))? {
                if let Some(id) = with(store, |s| s.ingest_server_deletion(&key, held))? {
                    report.notes.push(id);
                }
            }
        }
        if !held {
            state.cursor = match failed {
                Some(seq) => (seq - 1).max(state.cursor),
                None => head,
            };
        }
        if reset {
            with(store, |s| s.mark_unsent_dirty())?;
        }
        if !state.joined {
            with(store, |s| s.find_likely_pairs(&inserted))?;
        }
        with(store, |s| s.set_sync_state(&state))?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn apply(
        &mut self,
        store: &impl StoreLock,
        report: &mut SyncReport,
        name: &str,
        sha: &str,
        sealed: &[u8],
        candidates: &mut JoinCandidates,
        inserted: &mut Vec<String>,
    ) -> Result<bool, RemoteError> {
        let mut fail = |why: &str| -> Result<bool, RemoteError> {
            report.errors.push(format!("object {} {why}", short(name)));
            Ok(false)
        };
        if sha_hex(sealed) != sha {
            return fail("arrived damaged");
        }
        let Ok(plain) = self.lock.open(sealed) else {
            return fail("cannot be decrypted with this key");
        };
        let Some(envelope) = Envelope::decode(&plain) else {
            return fail("is not readable by this version");
        };
        if self.lock.name(&envelope.key) != name {
            return fail("is stored under the wrong name");
        }
        let plain_sha = sha_hex(&plain);
        if envelope.note_id().is_some() {
            match with(store, |s| {
                s.ingest_server_note(name, sha, &envelope, &plain_sha, candidates)
            }) {
                Ok(arrived) => {
                    report.labels_changed |= !arrived.changed.is_empty();
                    report.conflicts += usize::from(arrived.conflict);
                    report.notes.extend(arrived.changed);
                    inserted.extend(arrived.inserted);
                }
                Err(e) => {
                    report.errors.push(e.to_string());
                    return Ok(false);
                }
            }
        } else if envelope.key == MANIFEST_KEY {
            let text = envelope.manifest.clone().unwrap_or_default();
            match with(store, |s| s.ingest_server_manifest(name, sha, &text)) {
                Ok(changed) => report.labels_changed |= changed,
                Err(e) => {
                    report.errors.push(e.to_string());
                    return Ok(false);
                }
            }
        } else if let (Some(file), Some(bytes)) =
            (envelope.attachment_file(), envelope.attachment_bytes())
        {
            let dir = self.attachments.clone();
            if let Err(e) = with(store, |s| {
                s.ingest_server_attachment(name, sha, file, &bytes, dir.as_deref())
            }) {
                report.errors.push(e.to_string());
                return Ok(false);
            }
        }
        Ok(true)
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

    fn seal(&self, pending: Vec<Pending>, report: &mut SyncReport) -> Vec<Sealed> {
        let max = self.remote.max_object_bytes();
        let mut out = Vec::with_capacity(pending.len());
        for p in pending {
            let bytes = p.plain.as_deref().map(|plain| self.lock.seal(plain));
            if bytes.as_ref().is_some_and(|b| b.len() as u64 > max) {
                report.too_large.push(p.key);
                continue;
            }
            out.push(Sealed {
                name: self.lock.name(&p.key),
                sha: bytes.as_deref().map(sha_hex),
                bytes,
                pending: p,
            });
        }
        out
    }

    fn upload(&mut self, sealed: &[Sealed]) -> Result<(), RemoteError> {
        let shas: Vec<String> = sealed.iter().filter_map(|s| s.sha.clone()).collect();
        if shas.is_empty() {
            return Ok(());
        }
        let missing = self.remote.missing(&shas)?;
        let blobs: Vec<(String, Vec<u8>)> = sealed
            .iter()
            .filter_map(|s| match (&s.sha, &s.bytes) {
                (Some(sha), Some(bytes)) if missing.contains(sha) => {
                    Some((sha.clone(), bytes.clone()))
                }
                _ => None,
            })
            .collect();
        if blobs.is_empty() {
            return Ok(());
        }
        self.remote.upload(&blobs)
    }

    fn ops(batch: &[Sealed], staging: bool) -> Vec<RemoteOp> {
        batch
            .iter()
            .map(|s| RemoteOp {
                name: s.name.clone(),
                base: if staging {
                    None
                } else {
                    s.pending.base.clone()
                },
                sha: s.sha.clone(),
            })
            .collect()
    }

    fn push(&mut self, store: &impl StoreLock, report: &mut SyncReport) -> Result<(), RemoteError> {
        let dir = self.attachments.clone();
        let pending = with(store, |s| s.pending_server_pushes(dir.as_deref()))?;
        let mut state = with(store, |s| s.sync_state())?;
        let mut batches = pending.into_iter().peekable();
        while batches.peek().is_some() {
            let chunk: Vec<Pending> = batches.by_ref().take(PUSH_BATCH).collect();
            let sealed = self.seal(chunk, report);
            if sealed.is_empty() {
                continue;
            }
            self.upload(&sealed)?;
            self.remote
                .commit(state.epoch, &Self::ops(&sealed, false), false)?;
            with(store, |st| {
                for s in &sealed {
                    st.server_pushed(&s.pending, &s.name, s.sha.as_deref())?;
                }
                Ok(())
            })?;
            report.pushed += sealed.len();
        }
        if !state.joined {
            state.joined = true;
            with(store, |s| s.set_sync_state(&state))?;
        }
        Ok(())
    }

    fn holds_everything(
        &mut self,
        store: &impl StoreLock,
        staged: &[Pending],
    ) -> Result<(), RemoteError> {
        let marker = Lock::Plain.name(MODE_KEY);
        let all = self.everything()?;
        let mut live: BTreeMap<String, bool> = BTreeMap::new();
        for change in all.changes {
            live.insert(change.name, change.sha.is_some());
        }
        let names: Vec<String> = live
            .into_iter()
            .filter(|(name, alive)| *alive && *name != marker)
            .map(|(name, _)| name)
            .collect();
        let keys: HashSet<String> = staged.iter().map(|p| p.key.clone()).collect();
        let missing = with(store, |s| s.staged_keys_cover(&names, &keys))?;
        match missing.len() {
            0 => Ok(()),
            n => Err(RemoteError::Refused(format!(
                "{n} objects on the server are not on this device; sync them here first"
            ))),
        }
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
            if !report.errors.is_empty() || !report.too_large.is_empty() || report.held_removals > 0
            {
                return Err(RemoteError::Refused(format!(
                    "this device could not read or send everything, so it cannot switch: {}",
                    report
                        .errors
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "removals are waiting for a decision".into())
                )));
            }
            let state = with(store, |s| s.sync_state())?;
            let dir = self.attachments.clone();
            let mut everything = with(store, |s| s.all_server_objects(dir.as_deref()))?;
            self.holds_everything(store, &everything)?;
            if let (Lock::Encrypted(old), Lock::Plain) = (&self.lock, &next) {
                let text = plain_proof_text(
                    state.library_id.as_deref().unwrap_or_default(),
                    state.epoch + 1,
                );
                everything.push(Pending {
                    key: MODE_KEY.to_string(),
                    base: None,
                    plain: Some(Envelope::mode_marker(old.prove(&text)).encode()),
                });
            }
            let previous = std::mem::replace(&mut self.lock, next);
            let mut staged_items = Vec::new();
            let mut staged: Result<(), RemoteError> = Ok(());
            let mut first = true;
            let mut rest = everything.into_iter().peekable();
            while staged.is_ok() && rest.peek().is_some() {
                let chunk: Vec<Pending> = rest.by_ref().take(PUSH_BATCH).collect();
                let sealed = self.seal(chunk, &mut report);
                if !report.too_large.is_empty() {
                    staged = Err(RemoteError::Refused(
                        "a note is too large once encrypted; the switch was not made".into(),
                    ));
                    break;
                }
                staged = self.upload(&sealed).and_then(|()| {
                    self.remote
                        .commit(state.epoch + 1, &Self::ops(&sealed, true), first)
                        .map(|_| ())
                });
                first = false;
                staged_items.extend(sealed);
            }
            let expected = staged_items.len();
            let switched = staged.and_then(|()| {
                self.remote
                    .switch(state.epoch, state.cursor, mode, recipient, expected)
            });
            match switched {
                Ok(epoch) => {
                    let saved = SyncState {
                        library_id: state.library_id.clone(),
                        epoch,
                        cursor: 0,
                        joined: true,
                    };
                    with(store, |s| {
                        s.forget_sync_bases()?;
                        for item in staged_items.iter().filter(|i| i.pending.key != MODE_KEY) {
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
