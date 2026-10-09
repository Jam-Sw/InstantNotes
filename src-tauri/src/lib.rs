//! IPC layer: thin #[tauri::command] handlers mapping the core Store to the
//! API.md contract, plus app shell (tray, global shortcut, windows).
//! No business logic lives here — that's instantnotes-core's job.

use instantnotes_core::types::*;
use instantnotes_core::Store;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    store: Mutex<Store>,
}

fn locked<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Store>, CmdError> {
    state
        .store
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))
}

// Every write command announces itself through one of these, and no read
// does, so they double as the vault mirror's flush trigger (shell/mirror.rs).

fn emit_notes_changed(app: &AppHandle) {
    let _ = app.emit(events::NOTES_CHANGED, ());
    request_vault_flush(app);
}

fn emit_tags_changed(app: &AppHandle) {
    let _ = app.emit(events::TAGS_CHANGED, ());
    request_vault_flush(app);
}

fn emit_workspaces_changed(app: &AppHandle) {
    let _ = app.emit(events::WORKSPACES_CHANGED, ());
    request_vault_flush(app);
}

// ---- shortcut status ----

/// Set once at startup when global-shortcut registration failed (another app
/// owns the hotkey). Queryable because the "shortcut:failed" event fires
/// before the library webview has listeners attached, so an event alone
/// would be lost.
pub(crate) struct ShortcutStatus {
    failed: Option<ShortcutFailure>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutFailure {
    label: String,
    wayland: bool,
}

mod commands;
mod error;
mod events;
mod shell;
use commands::{
    feedback::*, graph::*, import::*, notes::*, settings::*, stats::*, tags::*, vault::*,
    workspaces::*,
};
use error::{CmdError, CmdResult};
use shell::{
    agents::*, capture::*, files::*, mirror::*, quit::*, stickies::*, update::*, windows::*,
};

// ---- app shell ----

pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be the first plugin. A second launch (e.g. opening
        // the app while it already lives in the tray) is routed into this callback
        // and surfaces the running window, instead of starting a rival process -
        // which would otherwise mean two trays and two writers on one database.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if asks_for_capture(&argv) {
                toggle_capture_window(app);
                return;
            }
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
            let (mut store, recovered) = match Store::open_or_recover(&db_path) {
                Ok(ok) => ok,
                // Intact file, unknown future schema: nothing here is safe to
                // migrate, recover, or overwrite. Tell the user and stop,
                // rather than let the error propagate out to build().expect()
                // (a panic there aborts the process before the dialog plugin
                // ever gets to run its event loop).
                Err(e) if e.is_schema_too_new() => {
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(
                            "This notes library was created by a newer version of \
                             InstantNotes. Update the app to open it.",
                        )
                        .title("Library too new")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                    return Ok(());
                }
                Err(e) => return Err(format!("cannot open store: {e}").into()),
            };
            // Resume the live vault mirror, if one is set. A setting that
            // cannot be read leaves mirroring off rather than failing launch.
            if store.attach_saved_vault().is_err() {
                eprintln!("vault mirror setting unreadable; mirroring stays off");
            }
            app.manage(AppState {
                store: Mutex::new(store),
            });
            app.manage(CaptureMetrics::default());
            app.manage(start_vault_flusher(app.handle()));
            app.manage(start_agent_watcher(app.handle(), db_path.clone()));
            // Catch up anything a crash or a missing drive left pending, and
            // any attachment added while mirroring was paused.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let _ = mirror_attachments(&handle);
                    request_vault_flush(&handle);
                });
            }
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
            let new_board_item = MenuItem::with_id(
                app,
                "new_whiteboard",
                "New Whiteboard",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let new_sheet_item =
                MenuItem::with_id(app, "new_sheet", "New Sheet", true, None::<&str>)?;
            let export_item =
                MenuItem::with_id(app, "export_note", "Export Note As…", true, None::<&str>)?;
            let sticky_item = MenuItem::with_id(
                app,
                "toggle_sticky",
                "Pop Out as Sticky",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let file_submenu = {
                let builder = SubmenuBuilder::new(app, "File")
                    .item(&new_note_item)
                    .item(&new_board_item)
                    .item(&new_sheet_item)
                    .separator()
                    .item(&sticky_item)
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
            // Off macOS a menu is a bar inside a window, and an app-wide one
            // lands on every window, stickies and the capture panel included:
            // a bare File/Edit row over a frameless, transparent window. Only
            // the library has a frame to hang it in; it is never rebuilt.
            #[cfg(target_os = "macos")]
            app.set_menu(app_menu)?;
            #[cfg(not(target_os = "macos"))]
            if let Some(library) = app.get_webview_window("library") {
                library.set_menu(app_menu)?;
            }
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "settings" => {
                    show_library_window(app);
                    let _ = app.emit(events::SETTINGS_OPEN, ());
                }
                "new_note" => {
                    show_library_window(app);
                    let _ = app.emit(events::MENU_NEW_NOTE, ());
                }
                "new_whiteboard" => {
                    show_library_window(app);
                    let _ = app.emit(events::MENU_NEW_WHITEBOARD, ());
                }
                "new_sheet" => {
                    show_library_window(app);
                    let _ = app.emit(events::MENU_NEW_SHEET, ());
                }
                "export_note" => {
                    show_library_window(app);
                    let _ = app.emit(events::MENU_EXPORT_NOTE, ());
                }
                // Library only: the note it acts on is the library's open one.
                "toggle_sticky" => {
                    let _ = app.emit_to("library", events::MENU_TOGGLE_STICKY, ());
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
                        let _ = app.emit(events::UPDATER_CHECK, ());
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
            let wayland =
                cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some();
            let shortcut_failure = match app.global_shortcut().register(shortcut) {
                Err(e) => {
                    // Content-free log per SEC-001; the welcome screen surfaces
                    // the conflict to the user.
                    eprintln!("global shortcut registration failed: {e}");
                    Some(false)
                }
                Ok(()) if wayland => Some(true),
                Ok(()) => None,
            }
            .map(|wayland| ShortcutFailure {
                label: shortcut_label.to_string(),
                wayland,
            });
            if let Some(failure) = &shortcut_failure {
                let _ = app.emit(events::SHORTCUT_FAILED, failure.clone());
            }
            app.manage(ShortcutStatus {
                failed: shortcut_failure,
            });

            if let Some(library) = app.get_webview_window("library") {
                #[cfg(not(debug_assertions))]
                {
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

            // Last: the store is managed and the library exists, so a sticky
            // restored now is never the app's first window.
            restore_stickies(app.handle());
            if asks_for_capture(&std::env::args().collect::<Vec<_>>()) {
                show_capture_window(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_note,
            get_note,
            update_note,
            soft_delete_note,
            restore_note,
            list_notes,
            search_notes,
            set_notes_flags,
            soft_delete_notes,
            restore_notes,
            destroy_notes,
            list_tags,
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
            sheet_csv,
            save_attachment,
            get_attachments_dir,
            import_image_file,
            allow_image_file,
            open_attachments_folder,
            library_graph,
            space_suggestions,
            tag_suggestion,
            dismiss_space_suggestion,
            restore_space_suggestion,
            unused_attachments,
            remove_unused_attachments,
            library_stats,
            export_vault,
            get_vault_status,
            set_vault_folder,
            verify_vault,
            stickies_location,
            scan_stickies,
            import_stickies,
            submit_feedback,
            open_feedback_log,
            open_url,
            install_update,
            quit_app,
            restart_app,
            capture_input_ready,
            get_capture_latency,
            get_shortcut_failure,
            pop_out_note,
            pop_in_note,
            answer_pop_in,
            list_stickies,
            get_sticky_view,
            set_sticky_level,
            set_sticky_collapsed,
            save_sticky_geometry,
            agent_connection,
            list_agent_activity,
            agent_activity_before,
            agent_activity_wire,
            list_agent_sessions,
            revert_agent_activity,
            end_agent_session,
            clear_agent_activity
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
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
