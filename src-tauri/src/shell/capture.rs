use crate::*;
use std::collections::VecDeque;
use tauri::{PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

const CAPTURE_SAMPLE_CAP: usize = 50;
const RECENT_TARGETS: i64 = 3;

pub(crate) const SHORTCUT_LABEL: &str = if cfg!(target_os = "macos") {
    if cfg!(debug_assertions) {
        "⌥⇧Space"
    } else {
        "⌥Space"
    }
} else if cfg!(debug_assertions) {
    "Ctrl+Shift+Alt+Space"
} else {
    "Ctrl+Shift+Space"
};

fn shortcut() -> Shortcut {
    let mods = match (cfg!(target_os = "macos"), cfg!(debug_assertions)) {
        (true, false) => Modifiers::ALT,
        (true, true) => Modifiers::ALT | Modifiers::SHIFT,
        (false, false) => Modifiers::CONTROL | Modifiers::SHIFT,
        (false, true) => Modifiers::CONTROL | Modifiers::SHIFT | Modifiers::ALT,
    };
    Shortcut::new(Some(mods), Code::Space)
}

pub(crate) fn register_shortcut(app: &tauri::App) -> Option<ShortcutFailure> {
    let wayland = cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some();
    match app.global_shortcut().register(shortcut()) {
        Err(e) => {
            eprintln!("global shortcut registration failed: {e}");
            Some(false)
        }
        Ok(()) if wayland => Some(true),
        Ok(()) => None,
    }
    .map(|wayland| ShortcutFailure {
        label: SHORTCUT_LABEL.to_string(),
        wayland,
    })
}

#[derive(Default)]
pub(crate) struct CaptureMetrics {
    inner: Mutex<CaptureMetricsInner>,
}

#[derive(Default)]
struct CaptureMetricsInner {
    shown_at: Option<std::time::Instant>,
    samples_ms: VecDeque<u64>,
}

impl CaptureMetrics {
    pub(crate) fn mark_shown(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.shown_at = Some(std::time::Instant::now());
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureLatencySummary {
    last_ms: Option<u64>,
    median_ms: Option<u64>,
    samples: usize,
}

fn push_capture_sample(samples: &mut VecDeque<u64>, ms: u64) {
    if samples.len() == CAPTURE_SAMPLE_CAP {
        samples.pop_front();
    }
    samples.push_back(ms);
}

fn median_ms(samples: &VecDeque<u64>) -> Option<u64> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted: Vec<u64> = samples.iter().copied().collect();
    let mid = sorted.len() / 2;
    Some(*sorted.select_nth_unstable(mid).1)
}

#[tauri::command]
pub fn capture_input_ready(metrics: State<'_, CaptureMetrics>) -> CmdResult<Option<u64>> {
    let mut inner = metrics
        .inner
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))?;
    let Some(shown) = inner.shown_at.take() else {
        return Ok(None);
    };
    let ms = shown.elapsed().as_millis() as u64;
    push_capture_sample(&mut inner.samples_ms, ms);
    Ok(Some(ms))
}

#[tauri::command]
pub fn get_capture_latency(metrics: State<'_, CaptureMetrics>) -> CmdResult<CaptureLatencySummary> {
    let inner = metrics
        .inner
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))?;
    Ok(CaptureLatencySummary {
        last_ms: inner.samples_ms.back().copied(),
        median_ms: median_ms(&inner.samples_ms),
        samples: inner.samples_ms.len(),
    })
}

#[tauri::command(async)]
pub fn capture_targets(state: State<'_, AppState>) -> CmdResult<Vec<NoteTitle>> {
    Ok(locked_reader(&state)?.recent_documents(RECENT_TARGETS)?)
}

#[tauri::command(async)]
pub fn capture_append(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    text: String,
) -> CmdResult<()> {
    locked(&state)?.append_paragraph(&id, &text)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_capture(app: AppHandle, restore_focus: Option<bool>) {
    if !restore_focus.unwrap_or(false) {
        focus::forget();
    }
    hide_capture_window(&app);
}

fn panel_origin(
    area_at: PhysicalPosition<i32>,
    area: PhysicalSize<u32>,
    panel: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let free = |room: u32, size: u32| (room.saturating_sub(size) / 2) as i32;
    PhysicalPosition::new(
        area_at.x + free(area.width, panel.width),
        area_at.y + free(area.height, panel.height),
    )
}

fn place_on_cursor_monitor(app: &AppHandle, w: &tauri::WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    let (Some(monitor), Ok(size), Ok(scale)) = (monitor, w.outer_size(), w.scale_factor()) else {
        let _ = w.center();
        return;
    };
    let ratio = monitor.scale_factor() / scale;
    let panel = PhysicalSize::new(
        (f64::from(size.width) * ratio).round() as u32,
        (f64::from(size.height) * ratio).round() as u32,
    );
    let area = monitor.work_area();
    if w.set_position(panel_origin(area.position, area.size, panel))
        .is_err()
    {
        let _ = w.center();
    }
}

pub(crate) fn show_capture_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window("capture") else {
        return;
    };
    if !w.is_visible().unwrap_or(false) {
        focus::remember();
        place_on_cursor_monitor(app, &w);
    }
    if let Some(metrics) = app.try_state::<CaptureMetrics>() {
        metrics.mark_shown();
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit(events::CAPTURE_SHOWN, ());
}

pub(crate) fn hide_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
    focus::give_back();
}

pub(crate) fn toggle_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        if w.is_visible().unwrap_or(false) {
            hide_capture_window(app);
        } else {
            show_capture_window(app);
        }
    }
}

pub(crate) fn asks_for_capture<S: AsRef<str>>(args: &[S]) -> bool {
    args.get(1).is_some_and(|arg| arg.as_ref() == "capture")
}

#[cfg(target_os = "macos")]
mod focus {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    use std::sync::Mutex;

    static PREVIOUS: Mutex<Option<Retained<NSRunningApplication>>> = Mutex::new(None);

    pub(super) fn remember() {
        let ours = NSRunningApplication::currentApplication();
        let front = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .filter(|app| *app != ours);
        if let Ok(mut previous) = PREVIOUS.lock() {
            *previous = front;
        }
    }

    pub(super) fn forget() {
        if let Ok(mut previous) = PREVIOUS.lock() {
            *previous = None;
        }
    }

    pub(super) fn give_back() {
        let Some(app) = PREVIOUS.lock().ok().and_then(|mut p| p.take()) else {
            return;
        };
        if !app.isTerminated() {
            let _ = app.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod focus {
    pub(super) fn remember() {}
    pub(super) fn forget() {}
    pub(super) fn give_back() {}
}

#[cfg(test)]
mod tests {
    use super::{
        asks_for_capture, median_ms, panel_origin, push_capture_sample, CAPTURE_SAMPLE_CAP,
    };
    use std::collections::VecDeque;
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn capture_samples_roll_over_at_the_cap() {
        let mut samples = VecDeque::new();
        for ms in 0..(CAPTURE_SAMPLE_CAP as u64 + 10) {
            push_capture_sample(&mut samples, ms);
        }
        assert_eq!(samples.len(), CAPTURE_SAMPLE_CAP);
        assert_eq!(samples.front().copied(), Some(10));
        assert_eq!(samples.back().copied(), Some(CAPTURE_SAMPLE_CAP as u64 + 9));
    }

    #[test]
    fn median_is_none_when_empty_and_stable_against_outliers() {
        let median = |s: &[u64]| median_ms(&s.iter().copied().collect());
        assert_eq!(median(&[]), None);
        assert_eq!(median(&[40]), Some(40));
        assert_eq!(median(&[35, 38, 40, 42, 900]), Some(40));
        assert_eq!(median(&[900, 40, 35, 42, 38]), Some(40));
    }

    #[test]
    fn only_a_capture_argument_opens_the_capture_panel() {
        assert!(asks_for_capture(&["instantnotes", "capture"]));
        assert!(!asks_for_capture(&["instantnotes"]));
        assert!(!asks_for_capture(&["instantnotes", "mcp", "capture"]));
        assert!(!asks_for_capture(&["capture"]));
    }

    #[test]
    fn the_panel_is_centred_in_the_work_area_of_its_monitor() {
        let at = panel_origin(
            PhysicalPosition::new(-1920, 25),
            PhysicalSize::new(1920, 1055),
            PhysicalSize::new(560, 160),
        );
        assert_eq!(at, PhysicalPosition::new(-1240, 472));
        let tight = panel_origin(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(400, 100),
            PhysicalSize::new(560, 160),
        );
        assert_eq!(tight, PhysicalPosition::new(0, 0));
    }
}
