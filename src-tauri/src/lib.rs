//! IPC layer: thin #[tauri::command] handlers mapping the core Store to the
//! API.md contract, plus app shell (tray, global shortcut, windows).
//! No business logic lives here — that's instantnotes-core's job.

use instantnotes_core::types::*;
use instantnotes_core::{AppError, Store};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    store: Mutex<Store>,
}

// ---- capture latency metrics ----
// "Capture is discharge" only holds if the panel is ready before the thought
// decays, so reveal-to-input-ready is tracked as a first-class number. The
// anchor is the moment the shell starts revealing the window: the earliest
// point we control (the OS delivers no timestamp for the hotkey press).
// Note content is never involved here.

/// Rolling window; enough for a stable median, small enough to forget history.
const CAPTURE_SAMPLE_CAP: usize = 50;

#[derive(Default)]
struct CaptureMetrics {
    inner: Mutex<CaptureMetricsInner>,
}

#[derive(Default)]
struct CaptureMetricsInner {
    shown_at: Option<std::time::Instant>,
    samples_ms: Vec<u64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CaptureLatencySummary {
    last_ms: Option<u64>,
    median_ms: Option<u64>,
    samples: usize,
}

fn push_capture_sample(samples: &mut Vec<u64>, ms: u64) {
    samples.push(ms);
    if samples.len() > CAPTURE_SAMPLE_CAP {
        samples.remove(0);
    }
}

fn median_ms(samples: &[u64]) -> Option<u64> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    Some(sorted[sorted.len() / 2])
}

/// Serializable error per API.md §3.6 / §11.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CmdError {
    code: String,
    message: String,
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        CmdError {
            code: e.code().to_string(),
            message: e.to_string(),
        }
    }
}

type CmdResult<T> = Result<T, CmdError>;

fn locked<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Store>, CmdError> {
    state.store.lock().map_err(|_| CmdError {
        code: "STORAGE_ERROR".into(),
        message: "internal state lock poisoned".into(),
    })
}

fn emit_notes_changed(app: &AppHandle) {
    let _ = app.emit("notes:changed", ());
}

fn emit_tags_changed(app: &AppHandle) {
    let _ = app.emit("tags:changed", ());
}

fn emit_workspaces_changed(app: &AppHandle) {
    let _ = app.emit("workspaces:changed", ());
}


mod commands;
use commands::{notes::*, settings::*, tags::*, workspaces::*};

// ---- capture latency commands ----

/// Called by the capture webview once its textarea has focus after a
/// reveal (post-paint). Consumes the pending stamp so a stray call can
/// never double-record; returns the measured reveal-to-ready milliseconds.
#[tauri::command]
fn capture_input_ready(metrics: State<'_, CaptureMetrics>) -> CmdResult<Option<u64>> {
    let mut inner = metrics.inner.lock().map_err(|_| CmdError {
        code: "STORAGE_ERROR".into(),
        message: "internal state lock poisoned".into(),
    })?;
    let Some(shown) = inner.shown_at.take() else {
        return Ok(None);
    };
    let ms = shown.elapsed().as_millis() as u64;
    push_capture_sample(&mut inner.samples_ms, ms);
    Ok(Some(ms))
}

#[tauri::command]
fn get_capture_latency(metrics: State<'_, CaptureMetrics>) -> CmdResult<CaptureLatencySummary> {
    let inner = metrics.inner.lock().map_err(|_| CmdError {
        code: "STORAGE_ERROR".into(),
        message: "internal state lock poisoned".into(),
    })?;
    Ok(CaptureLatencySummary {
        last_ms: inner.samples_ms.last().copied(),
        median_ms: median_ms(&inner.samples_ms),
        samples: inner.samples_ms.len(),
    })
}

// ---- window commands ----

// Window show/hide is instant and main-thread-friendly, so these stay synchronous
// (unlike the data/IO commands, which run async to keep off the UI thread).
#[tauri::command]
fn hide_capture(app: AppHandle) {
    hide_capture_window(&app);
}

#[tauri::command]
fn open_library(app: AppHandle) {
    show_library_window(&app);
}

/// Apply a native macOS vibrancy material to the library window, or clear it when
/// `material` is None/unknown. Vibrancy is the closest a webview app gets to the
/// Tahoe "Liquid Glass" look; it requires the always-transparent window and a
/// translucent surface above it (the theme's sidebar token). A no-op off macOS.
#[tauri::command]
fn set_window_vibrancy(app: AppHandle, material: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
        let Some(win) = app.get_webview_window("library") else {
            return;
        };
        // Any known material applies; None or an unknown string clears.
        let chosen = material.as_deref().and_then(|m| match m {
            "sidebar" => Some(NSVisualEffectMaterial::Sidebar),
            "under-window" => Some(NSVisualEffectMaterial::UnderWindowBackground),
            "header" => Some(NSVisualEffectMaterial::HeaderView),
            "menu" => Some(NSVisualEffectMaterial::Menu),
            "popover" => Some(NSVisualEffectMaterial::Popover),
            "hud" => Some(NSVisualEffectMaterial::HudWindow),
            _ => None,
        });
        match chosen {
            Some(m) => {
                let _ = apply_vibrancy(&win, m, None, None);
            }
            None => {
                let _ = clear_vibrancy(&win);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, material);
    }
}

/// Match the native library window's theme (titlebar and traffic-light treatment)
/// to the in-app light/dark variant. Tauri maps this to the window's OS appearance,
/// so the chrome follows the active theme instead of the launch-time system setting.
/// An unknown variant is a no-op; the borderless capture window has no native chrome
/// and is left alone.
#[tauri::command]
fn set_window_theme(app: AppHandle, variant: String) {
    use tauri::Theme;
    let theme = match variant.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return,
    };
    if let Some(win) = app.get_webview_window("library") {
        let _ = win.set_theme(Some(theme));
    }
}

// ---- theme file sharing ----
// Thin byte I/O for portable `.intheme.json` theme files. The open/save dialog
// runs in JS via the dialog plugin; Rust only reads/writes the chosen path, so
// no broad filesystem capability is needed. Validation happens in the webview
// before any token is applied.

/// Reject anything that isn't an absolute path to a `.json` file. The path is
/// chosen by the user through a native save/open dialog but arrives here from the
/// webview, so this guard keeps the command from becoming a way to read or write
/// arbitrary files anywhere on disk.
fn validate_theme_path(path: &str) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "theme path must be absolute".into(),
        });
    }
    let is_json = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "theme file must have a .json extension".into(),
        });
    }
    Ok(())
}

#[tauri::command(async)]
fn export_theme_file(path: String, contents: String) -> CmdResult<()> {
    validate_theme_path(&path)?;
    std::fs::write(&path, contents).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write theme file: {e}"),
    })
}

#[tauri::command(async)]
fn import_theme_file(path: String) -> CmdResult<String> {
    validate_theme_path(&path)?;
    std::fs::read_to_string(&path).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not read theme file: {e}"),
    })
}

// ---- note export ----

fn validate_export_path(path: &str) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "export path must be absolute".into(),
        });
    }
    let is_allowed = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "txt"));
    if !is_allowed {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "export file must have a .md or .txt extension".into(),
        });
    }
    Ok(())
}

#[tauri::command(async)]
fn export_note_file(path: String, contents: String) -> CmdResult<()> {
    validate_export_path(&path)?;
    std::fs::write(&path, contents).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write export file: {e}"),
    })
}

// ---- attachments ----
// Pasted/dropped images live as files under <app data>/attachments and notes
// reference them by relative `attachments/<name>` markdown paths, so exported
// markdown stays portable and the DB stays lean. The webview reads them back
// through the asset protocol (scoped to this directory in tauri.conf.json).

const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

fn attachments_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CmdError {
            code: "STORAGE_ERROR".into(),
            message: format!("no app data dir: {e}"),
        })?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not create attachments dir: {e}"),
    })?;
    Ok(dir)
}

#[tauri::command(async)]
fn get_attachments_dir(app: AppHandle) -> CmdResult<String> {
    Ok(attachments_dir(&app)?.to_string_lossy().into_owned())
}

/// Store one image. The body is the raw bytes (not JSON) so a screenshot paste
/// doesn't pay for number-array serialization; the extension rides in a header.
/// Returns the generated filename; the caller builds `attachments/<name>`.
#[tauri::command(async)]
fn save_attachment(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let ext = request
        .headers()
        .get("x-attachment-ext")
        .and_then(|v| v.to_str().ok())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: format!("unsupported attachment type: {ext:?}"),
        });
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "attachment body must be raw bytes".into(),
        });
    };
    if bytes.is_empty() {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "attachment is empty".into(),
        });
    }
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    let path = attachments_dir(&app)?.join(&name);
    std::fs::write(&path, bytes).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write attachment: {e}"),
    })?;
    Ok(name)
}

const REPO_URL: &str = "https://github.com/Jam-Sw/InstantNotes";

fn open_data_folder(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        // Via the opener plugin rather than a raw `open` subprocess, so it stays
        // on Tauri's permission-checked path. Called only from Rust with our own
        // data directory - never a webview-supplied path.
        let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
    }
}

// ---- icon cache refresh ----
// macOS caches an app's icon per bundle path (LaunchServices + iconservicesd).
// The in-app updater swaps the bundle in place at the same path and identifier,
// so without a nudge the Dock/Finder keep showing the icon cached for the old
// build. We record the version that last launched and, when it changes, ask
// macOS to re-read the bundle once.

/// True when the icon cache should be refreshed: the recorded last-launched
/// version is missing (pre-marker install or first launch) or differs from the
/// running version. Pure so it can be unit-tested without a real bundle.
fn icon_refresh_needed(previous: Option<&str>, current: &str) -> bool {
    previous != Some(current)
}

/// Record the running version next to the database and, when it changed since
/// the last launch, refresh the macOS icon cache. A no-op on the happy path
/// (same version) and in dev builds (no `.app` bundle).
fn refresh_icon_cache_if_updated(data_dir: &std::path::Path) {
    let current = env!("CARGO_PKG_VERSION");
    let marker = data_dir.join(".last_version");
    let stored = std::fs::read_to_string(&marker).ok();
    let previous = stored.as_deref().map(str::trim);
    if !icon_refresh_needed(previous, current) {
        return;
    }
    let _ = std::fs::write(&marker, current);
    #[cfg(target_os = "macos")]
    if let Some(bundle) = current_app_bundle() {
        refresh_macos_icon(bundle);
    }
}

/// Path to the running `.app` bundle, or `None` in a dev build where the
/// executable is not inside a `*.app/Contents/MacOS/` layout.
#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?; // MacOS -> Contents -> .app
    if bundle.extension()?.to_str()? == "app" {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

/// Nudge macOS to re-read the bundle's icon: re-register with LaunchServices,
/// bump the bundle mtime (part of the icon cache key), then relaunch the Dock.
/// Runs off the main thread; every step is best-effort.
#[cfg(target_os = "macos")]
fn refresh_macos_icon(bundle: std::path::PathBuf) {
    std::thread::spawn(move || {
        const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
        let _ = std::process::Command::new(LSREGISTER)
            .arg("-f")
            .arg(&bundle)
            .status();
        let _ = std::process::Command::new("touch").arg(&bundle).status();
        let _ = std::process::Command::new("killall").arg("Dock").status();
    });
}

// ---- window helpers ----

fn show_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        // Stamp before any window work so the sample covers the whole reveal.
        if let Some(metrics) = app.try_state::<CaptureMetrics>() {
            if let Ok(mut inner) = metrics.inner.lock() {
                inner.shown_at = Some(std::time::Instant::now());
            }
        }
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        // Frontend focuses the textarea and restores any preserved draft.
        let _ = w.emit("capture:shown", ());
    }
}

fn hide_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
}

fn toggle_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        if w.is_visible().unwrap_or(false) {
            hide_capture_window(app);
        } else {
            show_capture_window(app);
        }
    }
}

fn show_library_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ---- utility commands ----

#[tauri::command]
fn open_url(app: AppHandle, url: String) {
    let _ = app.opener().open_url(&url, None::<&str>);
}

// ---- quit handshake ----
// Body edits are debounced in the webview, so exiting the process directly
// would drop the tail of whatever was just typed. Every quit path (menu, tray,
// Dock) instead emits "app:quit-requested"; the library window flushes its
// pending edits and answers with the quit_app command, which really exits.

/// True once the frontend flushed and called quit_app, or once the fallback
/// gave up waiting. ExitRequested lets the exit proceed only when this is set,
/// so the flush handshake runs at most once per quit.
static QUIT_READY: AtomicBool = AtomicBool::new(false);

/// How long a quit waits for the webview flush before exiting anyway.
const QUIT_FLUSH_GRACE_MS: u64 = 800;

/// Ask the webviews to flush, then exit. The fallback timer exists because
/// quit must not block forever on a dead webview: if the frontend never
/// answers with quit_app, exit anyway after the grace period.
fn request_quit(app: &AppHandle) {
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
fn quit_app(app: AppHandle) {
    QUIT_READY.store(true, Ordering::Release);
    app.exit(0);
}

// ---- shortcut status ----

/// Set once at startup when global-shortcut registration failed (another app
/// owns the hotkey). Queryable because the "shortcut:failed" event fires
/// before the library webview has listeners attached, so an event alone
/// would be lost.
struct ShortcutStatus {
    failed: Option<String>,
}

#[tauri::command]
fn get_shortcut_failure(state: State<'_, ShortcutStatus>) -> Option<String> {
    state.failed.clone()
}

// ---- app shell ----

pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be the first plugin. A second launch (e.g. opening
        // the app while it already lives in the tray) is routed into this callback
        // and surfaces the running window, instead of starting a rival process -
        // which would otherwise mean two trays and two writers on one database.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_library_window(app);
            // Dev: a re-run of `npm run tauri:dev` is routed here instead of spawning
            // a fresh process, so reload the webview to pick up the latest frontend
            // rather than leaving the window frozen on the build it first loaded.
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("library") {
                let _ = w.eval("window.location.reload()");
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_capture_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Store: single writer over SQLite at the platform data dir.
            let dir = app
                .path()
                .app_data_dir()
                .expect("cannot resolve app data directory");
            std::fs::create_dir_all(&dir)?;
            // Dev builds can point at an existing database via INSTANTNOTES_DB_PATH
            // (e.g. the installed release's notes), so `npm run tauri:dev` works on
            // your real notes - one shared file, no copies. Release never sets the
            // env, so it keeps using this identity's own database.
            let db_path = std::env::var_os("INSTANTNOTES_DB_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| dir.join("instantnotes.db"));
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let (store, recovered) =
                Store::open_or_recover(&db_path).map_err(|e| format!("cannot open store: {e}"))?;
            app.manage(AppState {
                store: Mutex::new(store),
            });
            app.manage(CaptureMetrics::default());
            if recovered {
                // Non-blocking on purpose: setup must finish (single-instance
                // handshake, window creation) whether or not the user has
                // acknowledged the dialog.
                app.dialog()
                    .message(
                        "Your notes library could not be read, so a fresh one was \
                         started. The unreadable file was kept next to it with a \
                         \".corrupt\" suffix in case its contents can be recovered.",
                    )
                    .title("Library recovered")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }

            // After an in-place update, refresh the cached app icon once.
            refresh_icon_cache_if_updated(&dir);

            // App menu bar. The Edit submenu is required for Cut/Copy/Paste to
            // work in the WebView on every platform. The application submenu
            // (Services, Hide, Hide Others) is a macOS convention with no
            // Windows/Linux equivalent, so off macOS its Settings and Quit
            // entries live in the File submenu instead.
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
            // Custom Quit instead of PredefinedMenuItem::quit(): the predefined
            // item exits the process directly, skipping the flush handshake, so
            // ⌘Q would drop the tail of whatever was being typed.
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit InstantNotes", true, Some("CmdOrCtrl+Q"))?;
            #[cfg(target_os = "macos")]
            let app_submenu = SubmenuBuilder::new(app, "InstantNotes")
                .about(None)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;
            let new_note_item =
                MenuItem::with_id(app, "new_note", "New Note", true, Some("CmdOrCtrl+N"))?;
            let export_item =
                MenuItem::with_id(app, "export_note", "Export Note As…", true, None::<&str>)?;
            let file_submenu = {
                let builder = SubmenuBuilder::new(app, "File")
                    .item(&new_note_item)
                    .separator()
                    .item(&export_item);
                #[cfg(not(target_os = "macos"))]
                let builder = builder
                    .separator()
                    .item(&settings_item)
                    .separator()
                    .item(&quit_item);
                builder.build()?
            };
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            #[cfg(target_os = "macos")]
            let app_menu = MenuBuilder::new(app)
                .items(&[&app_submenu, &file_submenu, &edit_submenu])
                .build()?;
            #[cfg(not(target_os = "macos"))]
            let app_menu = MenuBuilder::new(app)
                .items(&[&file_submenu, &edit_submenu])
                .build()?;
            app.set_menu(app_menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "settings" => {
                    show_library_window(app);
                    let _ = app.emit("settings:open", ());
                }
                "new_note" => {
                    show_library_window(app);
                    let _ = app.emit("menu:new-note", ());
                }
                "export_note" => {
                    show_library_window(app);
                    let _ = app.emit("menu:export-note", ());
                }
                "quit" => request_quit(app),
                _ => {}
            });

            // Tray menu - the app's permanent presence. Dev builds use ⌥⇧Space so
            // they never fight an installed release for the system-wide ⌥Space hotkey.
            // The tab-separated hint only renders reliably in the macOS status
            // menu; other platforms surface the hotkey in the welcome screen.
            let capture_accel = if !cfg!(target_os = "macos") {
                "New Capture"
            } else if cfg!(debug_assertions) {
                "New Capture\t⌥⇧Space"
            } else {
                "New Capture\t⌥Space"
            };
            let new_capture =
                MenuItem::with_id(app, "new_capture", capture_accel, true, None::<&str>)?;
            let open_library_item =
                MenuItem::with_id(app, "open_library", "Open Library", true, None::<&str>)?;

            let about = PredefinedMenuItem::about(app, Some("About InstantNotes"), None)?;
            let check_updates = MenuItem::with_id(
                app,
                "check_updates",
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let repo =
                MenuItem::with_id(app, "open_repo", "Repository on GitHub", true, None::<&str>)?;
            let data_folder =
                MenuItem::with_id(app, "open_data_dir", "Open Data Folder", true, None::<&str>)?;
            let settings = Submenu::with_items(
                app,
                "Settings",
                true,
                &[
                    &about,
                    &check_updates,
                    &PredefinedMenuItem::separator(app)?,
                    &repo,
                    &data_folder,
                ],
            )?;

            let quit = MenuItem::with_id(app, "quit", "Quit InstantNotes", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &new_capture,
                    &open_library_item,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            TrayIconBuilder::with_id("main-tray")
                // A monochrome template image: macOS tints it for the light/dark
                // menu bar automatically, instead of showing the full-color app
                // icon (which looks pasted-in and never adapts).
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "new_capture" => show_capture_window(app),
                    "open_library" => show_library_window(app),
                    "check_updates" => {
                        show_library_window(app);
                        let _ = app.emit("updater:check", ());
                    }
                    "open_repo" => {
                        let _ = app.opener().open_url(REPO_URL, None::<&str>);
                    }
                    "open_data_dir" => open_data_folder(app),
                    // Through the flush handshake, never a direct exit; see
                    // the quit handshake section.
                    "quit" => request_quit(app),
                    _ => {}
                })
                .build(app)?;

            // Global shortcut: ⌥Space toggles the capture panel on macOS. Windows
            // reserves plain Alt+Space for the system window menu, so Windows and
            // Linux use Ctrl+Shift+Space. In dev builds add one more modifier -
            // the hotkey is exclusive, so a dev build and an installed release
            // (same hotkey) would otherwise silently collide.
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = if cfg!(target_os = "macos") {
                if cfg!(debug_assertions) {
                    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space)
                } else {
                    Shortcut::new(Some(Modifiers::ALT), Code::Space)
                }
            } else if cfg!(debug_assertions) {
                Shortcut::new(
                    Some(Modifiers::CONTROL | Modifiers::SHIFT | Modifiers::ALT),
                    Code::Space,
                )
            } else {
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
            };
            // Human-readable label for the conflict notice; mirrors the
            // registration matrix above and captureShortcut in platform.ts.
            let shortcut_label = if cfg!(target_os = "macos") {
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
            let shortcut_failure = app.global_shortcut().register(shortcut).err().map(|e| {
                // Content-free log per SEC-001; the welcome screen surfaces
                // the conflict to the user.
                eprintln!("global shortcut registration failed: {e}");
                shortcut_label.to_string()
            });
            if let Some(label) = &shortcut_failure {
                let _ = app.emit("shortcut:failed", label.clone());
            }
            app.manage(ShortcutStatus {
                failed: shortcut_failure,
            });

            if let Some(library) = app.get_webview_window("library") {
                #[cfg(not(debug_assertions))]
                {
                    // Release: hide to tray -- the app lives in the menu bar.
                    let handle = library.clone();
                    library.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = handle.hide();
                        }
                    });
                }
                #[cfg(debug_assertions)]
                {
                    // Dev: quit on close. Hide-to-tray creates zombie processes
                    // that trap single-instance re-launches in stale webviews.
                    let handle = library.app_handle().clone();
                    library.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            handle.exit(0);
                        }
                    });
                    let _ = library.set_focus();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_note,
            get_note,
            update_note,
            soft_delete_note,
            restore_note,
            permanently_delete_note,
            list_notes,
            search_notes,
            set_notes_flags,
            soft_delete_notes,
            restore_notes,
            destroy_notes,
            list_tags,
            get_or_create_tag,
            update_tag,
            delete_tag,
            add_tag_to_note,
            remove_tag_from_note,
            tags_for_note,
            list_workspaces,
            get_or_create_workspace,
            rename_workspace,
            delete_workspace,
            list_workspace_tags,
            add_note_to_workspace,
            remove_note_from_workspace,
            workspaces_for_note,
            get_setting,
            set_setting,
            delete_setting,
            hide_capture,
            open_library,
            set_window_vibrancy,
            set_window_theme,
            export_theme_file,
            import_theme_file,
            export_note_file,
            save_attachment,
            get_attachments_dir,
            open_url,
            quit_app,
            capture_input_ready,
            get_capture_latency,
            get_shortcut_failure
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // The updater's relaunch (request_restart) drives this exit
                // with RESTART_EXIT_CODE and latches restart-on-exit inside
                // Tauri. Preventing it would leave that latch set with no
                // exit coming, stranding the freshly installed update, so
                // the restart passes through untouched; updater.restart()
                // flushes pending edits before it ever calls relaunch.
                if code == Some(tauri::RESTART_EXIT_CODE) {
                    return;
                }
                // Exit paths that bypass the menu and tray (macOS Dock quit):
                // hold the exit, run the same flush handshake, and rely on
                // the same dead-webview fallback.
                if !QUIT_READY.load(Ordering::Acquire) {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        export_theme_file, icon_refresh_needed, import_theme_file, median_ms, push_capture_sample,
        CAPTURE_SAMPLE_CAP,
    };

    #[test]
    fn capture_samples_roll_over_at_the_cap() {
        let mut samples = Vec::new();
        for ms in 0..(CAPTURE_SAMPLE_CAP as u64 + 10) {
            push_capture_sample(&mut samples, ms);
        }
        assert_eq!(samples.len(), CAPTURE_SAMPLE_CAP);
        // Oldest entries were evicted; the newest survives.
        assert_eq!(samples.first().copied(), Some(10));
        assert_eq!(samples.last().copied(), Some(CAPTURE_SAMPLE_CAP as u64 + 9));
    }

    #[test]
    fn median_is_none_when_empty_and_stable_against_outliers() {
        assert_eq!(median_ms(&[]), None);
        assert_eq!(median_ms(&[40]), Some(40));
        // One slow cold start must not drag the reported number.
        assert_eq!(median_ms(&[35, 38, 40, 42, 900]), Some(40));
        // Input order is irrelevant.
        assert_eq!(median_ms(&[900, 40, 35, 42, 38]), Some(40));
    }

    #[test]
    fn icon_refresh_when_version_changed_or_unknown() {
        // First launch / upgrade from a build that never wrote the marker.
        assert!(icon_refresh_needed(None, "0.5.3"));
        // In-place update from an older recorded version.
        assert!(icon_refresh_needed(Some("0.5.2"), "0.5.3"));
        // Same version relaunch: nothing to refresh.
        assert!(!icon_refresh_needed(Some("0.5.3"), "0.5.3"));
    }

    #[test]
    fn theme_file_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "instantnotes-theme-{}.intheme.json",
            std::process::id()
        ));
        let path_str = path.to_string_lossy().to_string();
        let json = r#"{"id":"x","name":"X","version":1}"#.to_string();

        export_theme_file(path_str.clone(), json.clone()).expect("write");
        let read_back = import_theme_file(path_str.clone()).expect("read");
        assert_eq!(read_back, json);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn import_missing_file_errors() {
        let res = import_theme_file("/nonexistent/path/theme.intheme.json".into());
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, "STORAGE_ERROR");
    }

    #[test]
    fn theme_path_validation_rejects_non_absolute_and_non_json() {
        // Relative path → rejected before any filesystem access.
        assert!(export_theme_file("relative/theme.json".into(), "{}".into()).is_err());
        assert!(import_theme_file("relative/theme.json".into()).is_err());
        // Absolute but not a .json file → rejected.
        assert!(import_theme_file("/tmp/not-a-theme.txt".into()).is_err());
    }
}
