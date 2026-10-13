use crate::shell::server::{
    build_engine, is_server, record_report, server_settings, watch_server, ServerEngine, ServerLink,
};
use crate::*;
use instantnotes_core::vault::{transport, CycleReport, Syncer};
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

const SERVER_INTERVAL: Duration = Duration::from_secs(60);

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

enum Engine {
    Folder(Syncer),
    Server(Box<ServerEngine>, Arc<AtomicBool>),
}

impl Engine {
    fn interval(&self) -> Duration {
        match self {
            Engine::Folder(s) => s.interval(),
            Engine::Server(..) => SERVER_INTERVAL,
        }
    }
}

pub(crate) fn start_vault_sync(app: &AppHandle) -> VaultSync {
    let (poke, pokes) = channel::<()>();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut engine: Option<Engine> = None;
        loop {
            let woke = match &engine {
                Some(e) => pokes.recv_timeout(e.interval()),
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
            engine = current_engine(&handle, engine.take());
            match engine.as_mut() {
                None => {
                    let _ = handle.emit(events::VAULT_STATUS, ());
                }
                Some(Engine::Folder(s)) => {
                    let report = s.cycle(&handle.state::<AppState>().store);
                    announce(&handle, &report.notes, report.labels_changed);
                }
                Some(Engine::Server(server, stop)) => {
                    let link = handle.state::<ServerLink>();
                    let _guard = link.engine.lock().unwrap_or_else(|e| e.into_inner());
                    if link.allow_removals.swap(false, Ordering::Relaxed) {
                        server.sync.confirm_removals();
                    }
                    let legacy = take_legacy(&handle, &server.sync.remote.client);
                    let imported = legacy.as_ref().is_ok_and(|moved| *moved);
                    let report = tauri::async_runtime::block_on(
                        server.sync.cycle(&handle.state::<AppState>().store),
                    );
                    finish_legacy(&handle, &server.sync.remote.client, &report);
                    record_report(&handle, &report);
                    report_legacy(&handle, legacy.err());
                    announce(&handle, &report.notes, report.labels_changed || imported);
                    if imported {
                        let _ = handle.emit(events::NOTES_CHANGED, ());
                    }
                    if report.mode_changed || report.signed_out {
                        stop.store(true, Ordering::Relaxed);
                        engine = None;
                    }
                    if report.retry || report.mode_changed {
                        request_vault_sync(&handle);
                    }
                }
            }
        }
    });
    VaultSync { poke }
}

fn current_engine(app: &AppHandle, previous: Option<Engine>) -> Option<Engine> {
    let state = app.try_state::<AppState>()?;
    let wants_server = state.store.lock().ok().is_some_and(|s| is_server(&s));
    if wants_server {
        if let Some(Engine::Server(server, stop)) = previous {
            let still = state
                .store
                .lock()
                .ok()
                .and_then(|s| server_settings(&s))
                .is_some_and(|now| now == server.settings);
            if still {
                return Some(Engine::Server(server, stop));
            }
            stop.store(true, Ordering::Relaxed);
        }
        let server = build_engine(app)?;
        let stop = Arc::new(AtomicBool::new(false));
        watch_server(app.clone(), server.settings.clone(), Arc::clone(&stop));
        return Some(Engine::Server(Box::new(server), stop));
    }
    if let Some(Engine::Server(_, stop)) = &previous {
        stop.store(true, Ordering::Relaxed);
    }
    let previous = match previous {
        Some(Engine::Folder(s)) => Some(s),
        _ => None,
    };
    current_syncer(app, previous).map(Engine::Folder)
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

fn announce(app: &AppHandle, notes: &[String], labels_changed: bool) {
    if !notes.is_empty() {
        let _ = app.emit(events::NOTES_CHANGED, ());
        let _ = app.emit(events::VAULT_SYNCED, VaultSynced { note_ids: notes });
    }
    if labels_changed {
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
