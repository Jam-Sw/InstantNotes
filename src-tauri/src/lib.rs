//! IPC layer: thin #[tauri::command] handlers mapping the core Store to the
//! API.md contract, plus app shell (tray, global shortcut, windows).
//! No business logic lives here — that's instantnotes-core's job.

use instantnotes_core::types::*;
use instantnotes_core::{AppError, Store};
use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    store: Mutex<Store>,
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

// ---- note commands ----

#[tauri::command(async)]
fn create_note(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CreateNoteInput,
) -> CmdResult<Note> {
    let note = locked(&state)?.create_note(input)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
fn get_note(state: State<'_, AppState>, id: String, touch: Option<bool>) -> CmdResult<Note> {
    Ok(locked(&state)?.get_note(&id, touch.unwrap_or(false))?)
}

#[tauri::command(async)]
fn update_note(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    patch: UpdateNotePatch,
) -> CmdResult<Note> {
    let note = locked(&state)?.update_note(&id, patch)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
fn soft_delete_note(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<Note> {
    let note = locked(&state)?.soft_delete_note(&id)?;
    emit_notes_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
fn restore_note(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<Note> {
    let note = locked(&state)?.restore_note(&id)?;
    emit_notes_changed(&app);
    Ok(note)
}

#[tauri::command(async)]
fn permanently_delete_note(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    confirm: bool,
) -> CmdResult<()> {
    locked(&state)?.permanently_delete_note(&id, confirm)?;
    emit_notes_changed(&app);
    emit_tags_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn list_notes(state: State<'_, AppState>, filter: Option<NoteFilter>) -> CmdResult<Vec<Note>> {
    Ok(locked(&state)?.list_notes(filter.unwrap_or_default())?)
}

#[tauri::command(async)]
fn search_notes(
    state: State<'_, AppState>,
    text: String,
    limit: Option<i64>,
) -> CmdResult<Vec<SearchResult>> {
    Ok(locked(&state)?.search_notes(&text, limit.unwrap_or(50))?)
}

// ---- tag commands ----

#[tauri::command(async)]
fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<TagWithCount>> {
    Ok(locked(&state)?.list_tags()?)
}

#[tauri::command(async)]
fn get_or_create_tag(state: State<'_, AppState>, app: AppHandle, name: String) -> CmdResult<Tag> {
    let tag = locked(&state)?.get_or_create_tag(&name)?;
    emit_tags_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
fn update_tag(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> CmdResult<Tag> {
    let tag = locked(&state)?.update_tag(&id, name, color)?;
    emit_tags_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
fn delete_tag(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<()> {
    locked(&state)?.delete_tag(&id)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn add_tag_to_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    name: String,
) -> CmdResult<Tag> {
    let tag = locked(&state)?.add_tag_to_note(&note_id, &name)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(tag)
}

#[tauri::command(async)]
fn remove_tag_from_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    tag_id: String,
) -> CmdResult<()> {
    locked(&state)?.remove_tag_from_note(&note_id, &tag_id)?;
    emit_tags_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn tags_for_note(state: State<'_, AppState>, note_id: String) -> CmdResult<Vec<Tag>> {
    Ok(locked(&state)?.tags_for_note(&note_id)?)
}

// ---- workspace commands ----

#[tauri::command(async)]
fn list_workspaces(state: State<'_, AppState>) -> CmdResult<Vec<WorkspaceWithCount>> {
    Ok(locked(&state)?.list_workspaces()?)
}

#[tauri::command(async)]
fn get_or_create_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
) -> CmdResult<Workspace> {
    let ws = locked(&state)?.get_or_create_workspace(&name)?;
    emit_workspaces_changed(&app);
    Ok(ws)
}

#[tauri::command(async)]
fn rename_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    name: String,
) -> CmdResult<Workspace> {
    let ws = locked(&state)?.rename_workspace(&id, &name)?;
    emit_workspaces_changed(&app);
    Ok(ws)
}

#[tauri::command(async)]
fn delete_workspace(state: State<'_, AppState>, app: AppHandle, id: String) -> CmdResult<()> {
    locked(&state)?.delete_workspace(&id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn add_note_to_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    workspace_id: String,
) -> CmdResult<()> {
    locked(&state)?.add_note_to_workspace(&note_id, &workspace_id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn remove_note_from_workspace(
    state: State<'_, AppState>,
    app: AppHandle,
    note_id: String,
    workspace_id: String,
) -> CmdResult<()> {
    locked(&state)?.remove_note_from_workspace(&note_id, &workspace_id)?;
    emit_workspaces_changed(&app);
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command(async)]
fn workspaces_for_note(state: State<'_, AppState>, note_id: String) -> CmdResult<Vec<Workspace>> {
    Ok(locked(&state)?.workspaces_for_note(&note_id)?)
}

// ---- settings commands ----

#[tauri::command(async)]
fn get_setting(state: State<'_, AppState>, key: String) -> CmdResult<Option<serde_json::Value>> {
    Ok(locked(&state)?.get_setting(&key)?)
}

#[tauri::command(async)]
fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> CmdResult<()> {
    Ok(locked(&state)?.set_setting(&key, value)?)
}

#[tauri::command(async)]
fn delete_setting(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    Ok(locked(&state)?.delete_setting(&key)?)
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
            let store = Store::open(&db_path)
                .map_err(|e| format!("cannot open store: {e}"))?;
            app.manage(AppState {
                store: Mutex::new(store),
            });

            // After an in-place update, refresh the cached app icon once.
            refresh_icon_cache_if_updated(&dir);

            // macOS app menu bar. The Edit submenu is required for Cut/Copy/Paste
            // to work in the WebView.
            let settings_item = MenuItem::with_id(
                app,
                "settings",
                "Settings…",
                true,
                Some("CmdOrCtrl+,"),
            )?;
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
                .quit()
                .build()?;
            let new_note_item = MenuItem::with_id(
                app,
                "new_note",
                "New Note",
                true,
                Some("CmdOrCtrl+N"),
            )?;
            let export_item = MenuItem::with_id(
                app,
                "export_note",
                "Export Note As…",
                true,
                None::<&str>,
            )?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&new_note_item)
                .separator()
                .item(&export_item)
                .build()?;
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let app_menu = MenuBuilder::new(app)
                .items(&[&app_submenu, &file_submenu, &edit_submenu])
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
                _ => {}
            });

            // Tray menu - the app's permanent presence. Dev builds use ⌥⇧Space so
            // they never fight an installed release for the system-wide ⌥Space hotkey.
            let capture_accel = if cfg!(debug_assertions) {
                "New Capture\t⌥⇧Space"
            } else {
                "New Capture\t⌥Space"
            };
            let new_capture =
                MenuItem::with_id(app, "new_capture", capture_accel, true, None::<&str>)?;
            let open_library_item =
                MenuItem::with_id(app, "open_library", "Open Library", true, None::<&str>)?;

            let about =
                PredefinedMenuItem::about(app, Some("About InstantNotes"), None)?;
            let check_updates =
                MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Global shortcut: ⌥Space toggles the capture panel. In dev builds use
            // ⌥⇧Space instead - the system-wide ⌥Space is exclusive, so a dev build
            // and an installed release (same hotkey) would otherwise silently collide.
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = if cfg!(debug_assertions) {
                Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space)
            } else {
                Shortcut::new(Some(Modifiers::ALT), Code::Space)
            };
            if let Err(e) = app.global_shortcut().register(shortcut) {
                // Content-free log per SEC-001; conflict fallback UI is an M4 item.
                eprintln!("global shortcut registration failed: {e}");
            }

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
            add_note_to_workspace,
            remove_note_from_workspace,
            workspaces_for_note,
            get_setting,
            set_setting,
            delete_setting,
            hide_capture,
            open_library,
            set_window_vibrancy,
            export_theme_file,
            import_theme_file,
            export_note_file,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{export_theme_file, icon_refresh_needed, import_theme_file};

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
        let path = dir.join(format!("instantnotes-theme-{}.intheme.json", std::process::id()));
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
