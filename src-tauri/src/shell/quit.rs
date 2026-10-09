use crate::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static AWAITING: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

fn answering_windows(app: &AppHandle) -> HashSet<String> {
    app.webview_windows()
        .into_keys()
        .filter(|label| label == "library" || label.starts_with("sticky-"))
        .collect()
}

fn record_answer(awaiting: &mut HashSet<String>, label: &str) -> bool {
    awaiting.remove(label);
    awaiting.is_empty()
}

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

static RESTART: AtomicBool = AtomicBool::new(false);

pub(crate) static QUIT_READY: AtomicBool = AtomicBool::new(false);

const QUIT_FLUSH_GRACE_MS: u64 = 800;

const QUIT_VAULT_CHUNKS: usize = 1;

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

pub(crate) fn flush_before_exit(app: &AppHandle) {
    QUIT_READY.store(true, Ordering::Release);
    if let Ok(mut awaiting) = AWAITING.lock() {
        *awaiting = answering_windows(app);
    }
    let _ = app.emit(events::APP_QUIT_REQUESTED, ());
    wait_for_answers(&AWAITING, Duration::from_millis(QUIT_FLUSH_GRACE_MS));
    flush_vault_now(app, Some(QUIT_VAULT_CHUNKS));
}

fn wait_for_answers(awaiting: &Mutex<HashSet<String>>, grace: Duration) {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline && awaiting.lock().map(|a| !a.is_empty()).unwrap_or(false) {
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub(crate) fn release_quit() {
    QUIT_READY.store(false, Ordering::Release);
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    RESTART.store(true, Ordering::Release);
    request_quit(&app);
}

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
