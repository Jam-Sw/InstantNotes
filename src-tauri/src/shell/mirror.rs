//! The live vault mirror's background writer (stage 2 of
//! `feat-portable-vault-sync`). Every write command already announces itself
//! through one of the `emit_*_changed` helpers; those also poke this thread,
//! which waits for the writes to go quiet and then flushes the pending notes
//! to the vault folder. The write that marked a note pending never waits on
//! the disk, and a burst (typing an auto-titled first line) becomes one
//! write and one rename instead of dozens.
//!
//! Nothing can be lost here: pending notes are recorded in the database by
//! migration v5's triggers, so a missed poke, a failed write, or a crash
//! only delays the file until the next flush or the next launch.

use crate::*;
use instantnotes_core::vault;
use std::sync::mpsc::{channel, Sender};
use std::time::{Duration, Instant};

/// How long writes must pause before a flush.
const QUIET: Duration = Duration::from_millis(300);
/// A flush happens at least this often while writes keep arriving.
const MAX_DELAY: Duration = Duration::from_secs(2);
/// Notes written per lock hold, so a first mirror of a large library never
/// holds up an autosave for longer than one chunk. Each note costs about
/// 5 ms, almost all of it the fsync (measured on a real library), so a
/// chunk holds the store for roughly a quarter of a second.
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

/// Ask the background writer for a flush. A no-op before setup has
/// created it.
pub(crate) fn request_vault_flush(app: &AppHandle) {
    if let Some(flusher) = app.try_state::<VaultFlusher>() {
        let _ = flusher.poke.send(());
    }
}

/// Flush pending notes on this thread, chunk by chunk, releasing the store
/// between chunks. `max_chunks` bounds the work where waiting is visible
/// (quit); whatever is left stays pending for the next launch. Errors land
/// in the store's vault status for the Settings page, never in a log:
/// they carry note filenames, which are note titles (SEC-001).
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

/// Copy attachments the vault does not have yet into `<vault>/attachments`.
/// Names are uuids, so an existing name is already the same image. Skipped
/// while the vault folder is missing, which must never be recreated.
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
