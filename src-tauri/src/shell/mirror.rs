use crate::*;
use instantnotes_core::vault;
use std::sync::mpsc::{channel, Sender};
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_millis(300);
const MAX_DELAY: Duration = Duration::from_secs(2);
const CHUNK: usize = 50;

pub(crate) struct VaultFlusher {
    poke: Sender<()>,
}

pub(crate) fn start_vault_flusher(app: &AppHandle) -> VaultFlusher {
    let (poke, pokes) = channel::<()>();
    let handle = app.clone();
    std::thread::spawn(move || {
        while pokes.recv().is_ok() {
            let first = Instant::now();
            while first.elapsed() < MAX_DELAY && pokes.recv_timeout(QUIET).is_ok() {}
            flush_vault_now(&handle, None);
        }
    });
    VaultFlusher { poke }
}

pub(crate) fn request_vault_flush(app: &AppHandle) {
    if let Some(flusher) = app.try_state::<VaultFlusher>() {
        let _ = flusher.poke.send(());
    }
}

pub(crate) fn flush_vault_now(app: &AppHandle, max_chunks: Option<usize>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
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
            store.flush_vault(CHUNK)
        };
        chunks += 1;
        let more = matches!(&outcome, Ok(out)
            if out.errors.is_empty() && out.written > 0 && out.remaining > 0);
        if !more || max_chunks.is_some_and(|max| chunks >= max) {
            break;
        }
    }
    let _ = app.emit(events::VAULT_STATUS, ());
}

pub(crate) fn mirror_attachments(app: &AppHandle) -> CmdResult<()> {
    let root = {
        let state = app.state::<AppState>();
        let store = locked(&state)?;
        store.vault_root().map(std::path::Path::to_path_buf)
    };
    let Some(root) = root.filter(|r| r.is_dir()) else {
        return Ok(());
    };
    vault::copy_missing_files(&attachments_dir(app)?, &root.join("attachments"))
        .map(|_| ())
        .map_err(|e| CmdError::storage(format!("could not copy attachments into the vault: {e}")))
}
