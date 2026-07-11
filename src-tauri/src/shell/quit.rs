//! The quit handshake. Body edits are debounced in the webview, so exiting the
//! process directly would drop the tail of whatever was just typed. Every quit
//! path (menu, tray, Dock) emits "app:quit-requested"; the library window
//! flushes its pending edits and answers with quit_app, which really exits.

use crate::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// True once the frontend flushed and called quit_app, or once the fallback
/// gave up waiting. ExitRequested lets the exit proceed only when this is set,
/// so the flush handshake runs at most once per quit.
pub(crate) static QUIT_READY: AtomicBool = AtomicBool::new(false);

/// How long a quit waits for the webview flush before exiting anyway.
const QUIT_FLUSH_GRACE_MS: u64 = 800;

/// Ask the webviews to flush, then exit. The fallback timer exists because
/// quit must not block forever on a dead webview: if the frontend never
/// answers with quit_app, exit anyway after the grace period.
pub(crate) fn request_quit(app: &AppHandle) {
    let _ = app.emit("app:quit-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(QUIT_FLUSH_GRACE_MS));
        // swap keeps the fallback and quit_app from racing: whichever runs
        // first marks the handshake done and the other becomes a no-op.
        if !QUIT_READY.swap(true, Ordering::AcqRel) {
            handle.exit(0);
        }
    });
}

/// Final leg of the handshake: the library webview has flushed pending edits.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    QUIT_READY.store(true, Ordering::Release);
    app.exit(0);
}

#[tauri::command]
pub fn get_shortcut_failure(state: State<'_, ShortcutStatus>) -> Option<String> {
    state.failed.clone()
}
