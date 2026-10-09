//! The quit handshake. Body edits are debounced in the webview, so exiting the
//! process directly would drop the tail of whatever was just typed. Every quit
//! path (menu, tray, Dock) emits "app:quit-requested"; every window that holds
//! edits (the library and each sticky) flushes and answers with quit_app, and
//! the last answer really exits.

use crate::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Labels of the windows whose flush the current quit still waits for.
static AWAITING: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

/// Windows that answer the quit handshake: the library and every sticky. The
/// capture panel persists its draft on the event and never answers.
fn answering_windows(app: &AppHandle) -> HashSet<String> {
    app.webview_windows()
        .into_keys()
        .filter(|label| label == "library" || label.starts_with("sticky-"))
        .collect()
}

/// Record one window's answer; true once no window is left to wait for.
fn record_answer(awaiting: &mut HashSet<String>, label: &str) -> bool {
    awaiting.remove(label);
    awaiting.is_empty()
}

/// Exit once, whichever of the last answer and the fallback gets here first.
fn finish_quit(app: &AppHandle) {
    if !QUIT_READY.swap(true, Ordering::AcqRel) {
        flush_vault_now(app, Some(QUIT_VAULT_CHUNKS));
        if RESTART.load(Ordering::Acquire) {
            app.request_restart();
        } else {
            app.exit(0);
        }
    }
}

/// Set when the quit in progress should start the app again.
static RESTART: AtomicBool = AtomicBool::new(false);

/// True once the frontend flushed and called quit_app, or once the fallback
/// gave up waiting. ExitRequested lets the exit proceed only when this is set,
/// so the flush handshake runs at most once per quit.
pub(crate) static QUIT_READY: AtomicBool = AtomicBool::new(false);

/// How long a quit waits for the webview flush before exiting anyway.
const QUIT_FLUSH_GRACE_MS: u64 = 800;

/// The vault mirror gets one chunk on the way out: enough for anything just
/// typed, without making quit wait on a large first mirror, which the next
/// launch resumes from the pending rows.
const QUIT_VAULT_CHUNKS: usize = 1;

/// Ask the webviews to flush, then exit. The fallback timer exists because
/// quit must not block forever on a dead webview: if the frontend never
/// answers with quit_app, exit anyway after the grace period.
pub(crate) fn request_quit(app: &AppHandle) {
    if let Ok(mut awaiting) = AWAITING.lock() {
        *awaiting = answering_windows(app);
    }
    let _ = app.emit(events::APP_QUIT_REQUESTED, ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(QUIT_FLUSH_GRACE_MS));
        finish_quit(&handle);
    });
}

/// The handshake's flush without its exit, for an exit the app does not drive:
/// on Windows the updater starts the installer and ends the process with
/// `std::process::exit`, past ExitRequested. QUIT_READY is held so the windows'
/// quit_app answers do not exit first; `release_quit` lets it go if the
/// process is still here afterwards.
pub(crate) fn flush_before_exit(app: &AppHandle) {
    QUIT_READY.store(true, Ordering::Release);
    if let Ok(mut awaiting) = AWAITING.lock() {
        *awaiting = answering_windows(app);
    }
    let _ = app.emit(events::APP_QUIT_REQUESTED, ());
    wait_for_answers(&AWAITING, Duration::from_millis(QUIT_FLUSH_GRACE_MS));
    flush_vault_now(app, Some(QUIT_VAULT_CHUNKS));
}

/// Block until every awaited window has answered, or `grace` runs out.
fn wait_for_answers(awaiting: &Mutex<HashSet<String>>, grace: Duration) {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline && awaiting.lock().map(|a| !a.is_empty()).unwrap_or(false) {
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub(crate) fn release_quit() {
    QUIT_READY.store(false, Ordering::Release);
}

/// Quit through the handshake and start again, which is how an installed update
/// takes effect: closing the window only hides the app to the tray, and the
/// running process keeps the old version. The restart runs the AppImage path
/// on Linux, so it starts the swapped-in file.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    RESTART.store(true, Ordering::Release);
    request_quit(&app);
}

/// A window's leg of the handshake: it has flushed its pending edits. The
/// app exits when the last window it waits for has answered.
#[tauri::command]
pub fn quit_app(app: AppHandle, window: tauri::WebviewWindow) {
    let done = AWAITING
        .lock()
        .map(|mut awaiting| record_answer(&mut awaiting, window.label()))
        .unwrap_or(true);
    if done {
        finish_quit(&app);
    }
}

#[tauri::command]
pub fn get_shortcut_failure(state: State<'_, ShortcutStatus>) -> Option<ShortcutFailure> {
    state.failed.clone()
}

#[cfg(test)]
mod tests {
    use super::{record_answer, wait_for_answers};
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[test]
    fn quit_waits_for_every_window_that_holds_edits() {
        let mut awaiting: HashSet<String> = ["library", "sticky-a"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(!record_answer(&mut awaiting, "library"));
        // A repeat answer from the same window does not count twice.
        assert!(!record_answer(&mut awaiting, "library"));
        assert!(record_answer(&mut awaiting, "sticky-a"));
    }

    #[test]
    fn a_hand_off_waits_for_the_last_answer_and_no_longer() {
        let awaiting = Arc::new(Mutex::new(HashSet::from(["library".to_string()])));
        let answering = Arc::clone(&awaiting);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            answering.lock().unwrap().clear();
        });
        let start = Instant::now();
        wait_for_answers(&awaiting, Duration::from_secs(5));
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(awaiting.lock().unwrap().is_empty());
    }

    #[test]
    fn a_hand_off_stops_waiting_on_a_window_that_never_answers() {
        let awaiting = Mutex::new(HashSet::from(["sticky-a".to_string()]));
        let start = Instant::now();
        wait_for_answers(&awaiting, Duration::from_millis(100));
        assert!(start.elapsed() >= Duration::from_millis(100));
        assert!(!awaiting.lock().unwrap().is_empty());
    }
}
