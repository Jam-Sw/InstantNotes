use crate::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{LogicalPosition, LogicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SETTING_KEY: &str = "stickies";
const LABEL_PREFIX: &str = "sticky-";
const DEFAULT_SIZE: (f64, f64) = (320.0, 320.0);
const MIN_SIZE: (f64, f64) = (220.0, 160.0);
pub(crate) const STRIP_HEIGHT: f64 = 30.0;
const POP_IN_GRACE: Duration = Duration::from_millis(1500);
const VISIBLE_MARGIN: f64 = 40.0;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StickyLevel {
    #[default]
    Float,
    Normal,
    Desktop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyState {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub level: StickyLevel,
    #[serde(default)]
    pub collapsed: bool,
}

impl Default for StickyState {
    fn default() -> Self {
        StickyState {
            x: None,
            y: None,
            width: DEFAULT_SIZE.0,
            height: DEFAULT_SIZE.1,
            level: StickyLevel::default(),
            collapsed: false,
        }
    }
}

type StickyMap = BTreeMap<String, StickyState>;

pub(crate) fn label_for(note_id: &str) -> String {
    format!("{LABEL_PREFIX}{note_id}")
}

fn note_id_of(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX)
}

fn load_map(store: &Store) -> StickyMap {
    store
        .get_setting(SETTING_KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_map(store: &mut Store, map: &StickyMap) -> CmdResult<()> {
    let value =
        serde_json::to_value(map).map_err(|e| CmdError::storage(format!("stickies: {e}")))?;
    Ok(store.set_setting(SETTING_KEY, value)?)
}

fn with_map<T>(
    state: &State<'_, AppState>,
    edit: impl FnOnce(&mut StickyMap) -> T,
) -> CmdResult<T> {
    let mut store = locked(state)?;
    let mut map = load_map(&store);
    let out = edit(&mut map);
    save_map(&mut store, &map)?;
    Ok(out)
}

fn apply_level(win: &WebviewWindow, level: StickyLevel) {
    let _ = win.set_always_on_top(level == StickyLevel::Float);
    let _ = win.set_always_on_bottom(level == StickyLevel::Desktop);
    let _ = win.set_visible_on_all_workspaces(level != StickyLevel::Normal);
}

fn apply_collapsed(win: &WebviewWindow, sticky: &StickyState) {
    let width = win
        .inner_size()
        .ok()
        .zip(win.scale_factor().ok())
        .map(|(size, scale)| size.to_logical::<f64>(scale).width)
        .unwrap_or(sticky.width);
    if sticky.collapsed {
        let _ = win.set_min_size(Some(LogicalSize::new(MIN_SIZE.0, STRIP_HEIGHT)));
        let _ = win.set_max_size(Some(LogicalSize::new(16_384.0, STRIP_HEIGHT)));
        let _ = win.set_size(LogicalSize::new(width, STRIP_HEIGHT));
    } else {
        let _ = win.set_max_size(None::<LogicalSize<f64>>);
        let _ = win.set_min_size(Some(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1)));
        let _ = win.set_size(LogicalSize::new(width, sticky.height));
    }
}

fn build_window(app: &AppHandle, note_id: &str, sticky: &StickyState) -> tauri::Result<()> {
    let mut builder =
        WebviewWindowBuilder::new(app, label_for(note_id), WebviewUrl::App("sticky".into()))
            .title("InstantNotes Sticky")
            .inner_size(sticky.width, sticky.height)
            .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
            .decorations(false)
            .transparent(true)
            .skip_taskbar(true)
            .accept_first_mouse(true)
            .focused(true);
    builder = match (sticky.x, sticky.y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder.center(),
    };
    let win = builder.build()?;
    apply_level(&win, sticky.level);
    if sticky.collapsed {
        apply_collapsed(&win, sticky);
    }
    let handle = app.clone();
    let id = note_id.to_string();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let handle = handle.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                let _ = pop_in(&handle, &id);
            });
        }
    });
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(crate) fn is_reachable(rect: Area, monitors: &[Area]) -> bool {
    monitors.iter().any(|m| {
        let overlap_w = (rect.x + rect.width).min(m.x + m.width) - rect.x.max(m.x);
        let overlap_h = (rect.y + rect.height).min(m.y + m.height) - rect.y.max(m.y);
        overlap_w >= VISIBLE_MARGIN && overlap_h >= VISIBLE_MARGIN
    })
}

fn monitor_areas(app: &AppHandle) -> Vec<Area> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let pos = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            Area {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

pub(crate) fn restore_stickies(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(mut store) = state.store.lock() else {
        return;
    };
    let saved = load_map(&store);
    if saved.is_empty() {
        return;
    }
    let monitors = monitor_areas(app);
    let mut kept = StickyMap::new();
    for (id, mut sticky) in saved {
        let live = store.get_note(&id, false).is_ok_and(|n| !n.is_deleted);
        if !live {
            continue;
        }
        if let (Some(x), Some(y)) = (sticky.x, sticky.y) {
            let rect = Area {
                x,
                y,
                width: sticky.width,
                height: sticky.height,
            };
            if !monitors.is_empty() && !is_reachable(rect, &monitors) {
                sticky.x = None;
                sticky.y = None;
            }
        }
        if build_window(app, &id, &sticky).is_ok() {
            kept.insert(id, sticky);
        }
    }
    let _ = save_map(&mut store, &kept);
}

static POP_IN_WAITERS: std::sync::LazyLock<Mutex<HashMap<String, mpsc::Sender<bool>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn pop_in(app: &AppHandle, note_id: &str) -> CmdResult<()> {
    let label = label_for(note_id);
    if let Some(win) = app.get_webview_window(&label) {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut waiters) = POP_IN_WAITERS.lock() {
            waiters.insert(label.clone(), tx);
        }
        let _ = win.emit_to(&label, events::STICKY_CLOSE_REQUESTED, ());
        let answer = rx.recv_timeout(POP_IN_GRACE);
        if let Ok(mut waiters) = POP_IN_WAITERS.lock() {
            waiters.remove(&label);
        }
        if answer == Ok(false) {
            return Err(CmdError::storage(
                "The sticky couldn't save, so it stays open with your text.",
            ));
        }
        let _ = win.destroy();
    }
    let state = app.state::<AppState>();
    with_map(&state, |map| {
        map.remove(note_id);
    })?;
    let _ = app.emit(events::STICKIES_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn answer_pop_in(window: WebviewWindow, saved: bool) {
    if let Ok(waiters) = POP_IN_WAITERS.lock() {
        if let Some(tx) = waiters.get(window.label()) {
            let _ = tx.send(saved);
        }
    }
}

#[tauri::command(async)]
pub fn pop_out_note(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<()> {
    if let Some(win) = app.get_webview_window(&label_for(&id)) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let note = locked(&state)?.get_note(&id, false)?;
    if note.is_deleted {
        return Err(CmdError::validation(
            "a note in the Trash cannot be a sticky",
        ));
    }
    let sticky = with_map(&state, |map| map.entry(id.clone()).or_default().clone())?;
    if let Err(e) = build_window(&app, &id, &sticky) {
        let _ = with_map(&state, |map| {
            map.remove(&id);
        });
        return Err(CmdError::storage(format!("couldn't open the sticky: {e}")));
    }
    let _ = app.emit(events::STICKIES_CHANGED, ());
    Ok(())
}

#[tauri::command(async)]
pub fn pop_in_note(app: AppHandle, id: String) -> CmdResult<()> {
    pop_in(&app, &id)
}

#[tauri::command(async)]
pub fn list_stickies(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    Ok(load_map(&*locked(&state)?).into_keys().collect())
}

#[tauri::command(async)]
pub fn set_sticky_level(
    state: State<'_, AppState>,
    window: WebviewWindow,
    level: StickyLevel,
) -> CmdResult<()> {
    let Some(id) = note_id_of(window.label()) else {
        return Err(CmdError::validation("not a sticky window"));
    };
    apply_level(&window, level);
    with_map(&state, |map| {
        if let Some(sticky) = map.get_mut(id) {
            sticky.level = level;
        }
    })
}

#[tauri::command(async)]
pub fn set_sticky_collapsed(
    state: State<'_, AppState>,
    window: WebviewWindow,
    collapsed: bool,
) -> CmdResult<()> {
    let Some(id) = note_id_of(window.label()) else {
        return Err(CmdError::validation("not a sticky window"));
    };
    let sticky = with_map(&state, |map| {
        map.get_mut(id).map(|sticky| {
            sticky.collapsed = collapsed;
            sticky.clone()
        })
    })?;
    if let Some(sticky) = sticky {
        apply_collapsed(&window, &sticky);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyView {
    pub level: StickyLevel,
    pub collapsed: bool,
}

#[tauri::command(async)]
pub fn get_sticky_view(state: State<'_, AppState>, window: WebviewWindow) -> CmdResult<StickyView> {
    let id = note_id_of(window.label()).unwrap_or_default();
    Ok(load_map(&*locked(&state)?)
        .get(id)
        .map(|s| StickyView {
            level: s.level,
            collapsed: s.collapsed,
        })
        .unwrap_or_default())
}

#[tauri::command(async)]
pub fn save_sticky_geometry(state: State<'_, AppState>, window: WebviewWindow) -> CmdResult<()> {
    let Some(id) = note_id_of(window.label()) else {
        return Err(CmdError::validation("not a sticky window"));
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return Ok(());
    };
    let pos: LogicalPosition<f64> = pos.to_logical(scale);
    let size: LogicalSize<f64> = size.to_logical(scale);
    with_map(&state, |map| {
        if let Some(sticky) = map.get_mut(id) {
            sticky.x = Some(pos.x);
            sticky.y = Some(pos.y);
            sticky.width = size.width;
            if !sticky.collapsed {
                sticky.height = size.height;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Area = Area {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    };

    fn at(x: f64, y: f64) -> Area {
        Area {
            x,
            y,
            width: 320.0,
            height: 320.0,
        }
    }

    #[test]
    fn a_sticky_on_a_monitor_is_reachable() {
        assert!(is_reachable(at(100.0, 100.0), &[MAIN]));
        assert!(is_reachable(at(1440.0 - 60.0, 100.0), &[MAIN]));
    }

    #[test]
    fn a_sticky_on_a_missing_display_is_not() {
        assert!(!is_reachable(at(1800.0, 200.0), &[MAIN]));
        assert!(!is_reachable(at(1440.0 - 10.0, 100.0), &[MAIN]));
    }

    #[test]
    fn a_second_display_counts() {
        let left = Area {
            x: -1920.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        assert!(is_reachable(at(-600.0, 300.0), &[MAIN, left]));
    }

    #[test]
    fn labels_round_trip_note_ids() {
        let id = "0b9c7a52-5f1e-4c1f-9b7a-3f2d1e0c9a8b";
        assert_eq!(note_id_of(&label_for(id)), Some(id));
        assert_eq!(note_id_of("library"), None);
    }

    #[test]
    fn the_saved_map_round_trips_and_tolerates_older_entries() {
        let mut map = StickyMap::new();
        map.insert(
            "a".into(),
            StickyState {
                x: Some(10.0),
                y: Some(20.0),
                width: 300.0,
                height: 240.0,
                level: StickyLevel::Desktop,
                collapsed: true,
            },
        );
        let json = serde_json::to_value(&map).unwrap();
        assert_eq!(json["a"]["level"], "desktop");
        assert_eq!(serde_json::from_value::<StickyMap>(json).unwrap(), map);
        let bare: StickyMap =
            serde_json::from_value(serde_json::json!({"b": {"width": 300.0, "height": 200.0}}))
                .unwrap();
        assert_eq!(bare["b"].level, StickyLevel::Float);
        assert_eq!(bare["b"].x, None);
        assert!(!bare["b"].collapsed);
    }
}
