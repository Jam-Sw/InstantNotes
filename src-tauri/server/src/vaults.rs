use crate::events::{Change, Hub, NOTES_CHANGED, TAGS_CHANGED, VAULT_SYNCED, WORKSPACES_CHANGED};
use crate::libraries::{folder_name, Libraries, Library};
use instantnotes_core::vault::{transport, CycleReport, StoreLock, Syncer};
use instantnotes_core::Store;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

pub struct Vault {
    cycle: Mutex<Cycle>,
    poked: AtomicBool,
    synced: AtomicBool,
}

struct Cycle {
    syncer: Syncer,
    last: Option<Instant>,
    unreachable: Option<String>,
    trouble: (usize, usize),
}

struct Held<'a>(&'a Mutex<Library>);

impl StoreLock for Held<'_> {
    fn locked<T>(&self, f: impl FnOnce(&mut Store) -> T) -> Option<T> {
        self.0.lock().ok().map(|mut library| f(&mut library.store))
    }
}

impl Vault {
    pub fn poke(&self) {
        self.poked.store(true, Ordering::Relaxed);
    }

    fn due(&self) -> bool {
        self.poked.load(Ordering::Relaxed)
            || self
                .cycle
                .try_lock()
                .is_ok_and(|c| c.last.is_none_or(|at| at.elapsed() >= c.syncer.interval()))
    }
}

fn syncer_for(
    store: &mut Store,
    folder: &Path,
    attachments: &Path,
) -> Result<Option<Syncer>, String> {
    store.attach_saved_vault().map_err(|e| e.to_string())?;
    if store.vault_root() != Some(folder) {
        if !folder.is_dir() {
            return Ok(None);
        }
        store
            .configure_vault(Some(folder))
            .map_err(|e| e.to_string())?;
    }
    let name = store.vault_transport().map_err(|e| e.to_string())?;
    let transport = transport::open(&name, folder.to_path_buf())?;
    Ok(Some(Syncer::new(
        transport,
        Some(attachments.to_path_buf()),
    )))
}

pub fn attach(store: &mut Store, root: &Path, sub: &str, attachments: &Path) -> Option<Vault> {
    let library = folder_name(sub);
    let folder = root.join(&library);
    match syncer_for(store, &folder, attachments) {
        Ok(Some(syncer)) => Some(Vault {
            cycle: Mutex::new(Cycle {
                syncer,
                last: None,
                unreachable: None,
                trouble: (0, 0),
            }),
            poked: AtomicBool::new(false),
            synced: AtomicBool::new(false),
        }),
        Ok(None) => {
            crate::log(
                "vault.missing",
                &[
                    ("library", &library),
                    ("folder", &folder.display().to_string()),
                ],
            );
            None
        }
        Err(reason) => {
            crate::log("vault.error", &[("library", &library), ("reason", &reason)]);
            None
        }
    }
}

fn changes(report: &CycleReport) -> Vec<Change> {
    let mut out = Vec::new();
    if !report.notes.is_empty() {
        out.push(Change::new(NOTES_CHANGED, json!({ "origin": Value::Null })));
        out.push(Change::new(
            VAULT_SYNCED,
            json!({ "noteIds": report.notes }),
        ));
    }
    if report.labels_changed {
        out.push(Change::new(TAGS_CHANGED, Value::Null));
        out.push(Change::new(WORKSPACES_CHANGED, Value::Null));
    }
    out
}

fn record(cycle: &mut Cycle, sub: &str, report: &CycleReport) {
    let library = folder_name(sub);
    if report.unreachable != cycle.unreachable {
        match &report.unreachable {
            Some(reason) => crate::log(
                "vault.unreachable",
                &[("library", &library), ("reason", reason)],
            ),
            None => crate::log("vault.reachable", &[("library", &library)]),
        }
        cycle.unreachable = report.unreachable.clone();
    }
    let trouble = (report.errors.len(), report.held_removals);
    let worked = !report.notes.is_empty() || report.written > 0 || report.conflicts > 0;
    if worked || trouble != cycle.trouble {
        let first = report.errors.first().map(String::as_str).unwrap_or("");
        crate::log(
            "vault.sync",
            &[
                ("library", &library),
                ("read", &report.notes.len().to_string()),
                ("written", &report.written.to_string()),
                ("conflicts", &report.conflicts.to_string()),
                ("held", &report.held_removals.to_string()),
                ("errors", &report.errors.len().to_string()),
                ("first_error", first),
            ],
        );
    }
    cycle.trouble = trouble;
}

fn run(hub: &Hub, sub: &str, library: &Mutex<Library>, vault: &Vault, first_only: bool) {
    let mut cycle = vault.cycle.lock().unwrap_or_else(|e| e.into_inner());
    if first_only && cycle.last.is_some() {
        return;
    }
    vault.poked.store(false, Ordering::Relaxed);
    let report = cycle.syncer.cycle(&Held(library));
    cycle.last = Some(Instant::now());
    vault.synced.store(true, Ordering::Release);
    record(&mut cycle, sub, &report);
    hub.publish(sub, changes(&report));
}

pub fn first_sync(libraries: &Libraries, hub: &Hub, sub: &str) {
    if let Ok(Some((library, vault))) = libraries.vault(sub) {
        if !vault.synced.load(Ordering::Acquire) {
            run(hub, sub, &library, &vault, true);
        }
    }
}

pub fn sync_due(libraries: &Libraries, hub: &Hub) {
    for sub in hub.watched() {
        let _ = libraries.with(&sub, |_| Ok(()));
    }
    for (sub, (library, vault)) in libraries.open_vaults() {
        if vault.due() {
            run(hub, &sub, &library, &vault, false);
        }
    }
}
