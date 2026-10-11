use super::scan::{list_vault, Settled, ATTACHMENTS_DIR};
use super::transport::{Reach, Transport};
use super::write::copy_missing_files;
use crate::Store;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const CHUNK: usize = 50;

#[derive(Debug, Default)]
pub struct Ingest {
    pub changed: Vec<String>,
    pub settled: Vec<String>,
    pub conflicts: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Default)]
pub struct Removals {
    pub trashed: Vec<String>,
    pub held: usize,
}

#[derive(Debug, Default)]
pub struct CycleReport {
    pub unreachable: Option<String>,
    pub notes: Vec<String>,
    pub labels_changed: bool,
    pub conflicts: usize,
    pub held_removals: usize,
    pub written: usize,
    pub deferred: usize,
    pub errors: Vec<String>,
}

impl CycleReport {
    pub fn reached(&self) -> bool {
        self.unreachable.is_none()
    }
}

pub trait StoreLock {
    fn locked<T>(&self, f: impl FnOnce(&mut Store) -> T) -> Option<T>;
}

impl StoreLock for Mutex<Store> {
    fn locked<T>(&self, f: impl FnOnce(&mut Store) -> T) -> Option<T> {
        self.lock().ok().map(|mut store| f(&mut store))
    }
}

pub struct Syncer {
    transport: Box<dyn Transport>,
    settled: Settled,
    attachments: Option<PathBuf>,
}

impl Syncer {
    pub fn new(transport: Box<dyn Transport>, attachments: Option<PathBuf>) -> Syncer {
        Syncer {
            transport,
            settled: Settled::default(),
            attachments,
        }
    }

    pub fn root(&self) -> &Path {
        self.transport.root()
    }

    pub fn transport(&self) -> &'static str {
        self.transport.name()
    }

    pub fn interval(&self) -> Duration {
        self.transport.interval()
    }

    pub fn cycle(&mut self, store: &impl StoreLock) -> CycleReport {
        let mut report = CycleReport::default();
        self.run(store, &mut report);
        store.locked(|s| s.record_vault_sync(&report));
        report
    }

    fn run(&mut self, store: &impl StoreLock, report: &mut CycleReport) {
        if let Reach::Unreachable(why) = self.transport.pull() {
            self.settled.clear();
            report.unreachable = Some(why);
            return;
        }
        let root = self.root().to_path_buf();
        let listing = match list_vault(&root) {
            Ok(listing) => listing,
            Err(e) => {
                self.settled.clear();
                report.unreachable = Some(format!("cannot list {}: {e}", root.display()));
                return;
            }
        };
        self.settled.retain_listed(&listing);
        let candidates = self.settled.changed(&listing);
        for chunk in candidates.chunks(CHUNK) {
            let Some(ingested) = store.locked(|s| s.ingest_vault_files(&root, chunk)) else {
                report.errors.push("the library is unavailable".into());
                return;
            };
            match ingested {
                Ok(ingest) => {
                    self.settled.settle(&listing, &ingest.settled);
                    report.labels_changed |= !ingest.changed.is_empty();
                    report.notes.extend(ingest.changed);
                    report.conflicts += ingest.conflicts;
                    report.errors.extend(ingest.errors);
                }
                Err(e) => report.errors.push(e.to_string()),
            }
        }
        let Some(removals) = store.locked(|s| s.ingest_vault_removals(&root, &listing)) else {
            report.errors.push("the library is unavailable".into());
            return;
        };
        match removals {
            Ok(removals) => {
                report.held_removals = removals.held;
                report.notes.extend(removals.trashed);
            }
            Err(e) => report.errors.push(e.to_string()),
        }
        loop {
            let Some(outcome) = store.locked(|s| s.flush_vault(CHUNK)) else {
                report.errors.push("the library is unavailable".into());
                return;
            };
            match outcome {
                Ok(out) => {
                    report.written += out.written;
                    report.deferred += out.deferred;
                    report.labels_changed |= out.manifest_changed;
                    let more = out.errors.is_empty() && out.written > 0 && out.remaining > 0;
                    report.errors.extend(out.errors);
                    if !more {
                        break;
                    }
                }
                Err(e) => {
                    report.errors.push(e.to_string());
                    break;
                }
            }
        }
        if let Some(local) = &self.attachments {
            let shared = root.join(ATTACHMENTS_DIR);
            if shared.is_dir() {
                if let Err(e) = copy_missing_files(&shared, local) {
                    report
                        .errors
                        .push(format!("cannot copy attachments in: {e}"));
                }
            }
            if local.is_dir() {
                if let Err(e) = copy_missing_files(local, &shared) {
                    report
                        .errors
                        .push(format!("cannot copy attachments out: {e}"));
                }
            }
        }
        if let Reach::Unreachable(why) = self.transport.push() {
            report.errors.push(why);
        }
        report.notes.sort();
        report.notes.dedup();
    }
}
