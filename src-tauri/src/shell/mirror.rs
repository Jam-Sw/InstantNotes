use crate::*;
use instantnotes_core::vault::{transport, CycleReport, Syncer};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_millis(300);
const MAX_DELAY: Duration = Duration::from_secs(2);
const CHUNK: usize = 10;
const QUIT_CHUNK: usize = 50;
const BETWEEN_CHUNKS: Duration = Duration::from_millis(1);

pub(crate) struct VaultSync {
    poke: Sender<()>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultSynced<'a> {
    note_ids: &'a [String],
}

pub(crate) fn start_vault_sync(app: &AppHandle) -> VaultSync {
    let (poke, pokes) = channel::<()>();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut syncer: Option<Syncer> = None;
        loop {
            let woke = match &syncer {
                Some(s) => pokes.recv_timeout(s.interval()),
                None => pokes.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match woke {
                Ok(()) => {
                    let first = Instant::now();
                    while first.elapsed() < MAX_DELAY && pokes.recv_timeout(QUIET).is_ok() {}
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            syncer = current_syncer(&handle, syncer.take());
            let Some(s) = syncer.as_mut() else {
                let _ = handle.emit(events::VAULT_STATUS, ());
                continue;
            };
            let report = s.cycle(&handle.state::<AppState>().store);
            announce(&handle, &report);
        }
    });
    VaultSync { poke }
}

fn current_syncer(app: &AppHandle, previous: Option<Syncer>) -> Option<Syncer> {
    let state = app.try_state::<AppState>()?;
    let (root, name) = {
        let store = state.store.lock().ok()?;
        let root = store.vault_root()?.to_path_buf();
        (root, store.vault_transport().ok()?)
    };
    if let Some(s) = previous.filter(|s| s.root() == root && s.transport() == name) {
        return Some(s);
    }
    match transport::open(&name, root) {
        Ok(t) => Some(Syncer::new(t, attachments_dir(app).ok())),
        Err(why) => {
            if let Ok(mut store) = state.store.lock() {
                store.record_vault_sync(&CycleReport {
                    unreachable: Some(why),
                    ..Default::default()
                });
            }
            None
        }
    }
}

fn announce(app: &AppHandle, report: &CycleReport) {
    if !report.notes.is_empty() {
        let _ = app.emit(events::NOTES_CHANGED, ());
        let _ = app.emit(
            events::VAULT_SYNCED,
            VaultSynced {
                note_ids: &report.notes,
            },
        );
    }
    if report.labels_changed {
        let _ = app.emit(events::TAGS_CHANGED, ());
        let _ = app.emit(events::WORKSPACES_CHANGED, ());
    }
    let _ = app.emit(events::VAULT_STATUS, ());
}

pub(crate) fn request_vault_sync(app: &AppHandle) {
    if let Some(sync) = app.try_state::<VaultSync>() {
        let _ = sync.poke.send(());
    }
}

pub(crate) fn flush_vault_now(app: &AppHandle, max_chunks: Option<usize>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let chunk = if max_chunks.is_some() {
        QUIT_CHUNK
    } else {
        CHUNK
    };
    let mut chunks = 0;
    loop {
        let outcome = {
            let Ok(mut store) = state.store.lock() else {
                return;
            };
            if store.vault_root().is_none() {
                return;
            }
            store.flush_vault(chunk)
        };
        chunks += 1;
        let more = matches!(&outcome, Ok(out)
            if out.errors.is_empty() && out.written > 0 && out.remaining > 0);
        if !more || max_chunks.is_some_and(|max| chunks >= max) {
            break;
        }
        std::thread::sleep(BETWEEN_CHUNKS);
    }
    let _ = app.emit(events::VAULT_STATUS, ());
}
