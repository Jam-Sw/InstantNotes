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

pub(crate) static LIBRARY_DB: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

struct AppState {
    store: Mutex<Store>,
    reader: Mutex<Store>,
    analyst: Mutex<Store>,
}

fn locked<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Store>, CmdError> {
    state
        .store
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))
}

pub(crate) fn close_session() {
    if let Some(path) = LIBRARY_DB.get() {
        Store::mark_session_closed(path);
    }
}

fn locked_analyst<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Store>, CmdError> {
    state
        .analyst
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))
}

fn locked_reader<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Store>, CmdError> {
    state
        .reader
        .lock()
        .map_err(|_| CmdError::storage("internal state lock poisoned"))
}

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if asks_for_capture(&argv) {
                toggle_capture_window(app);
                return;
            }
            show_library_window(app);
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
            let db_path = std::env::var_os("INSTANTNOTES_DB_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| dir.join("instantnotes.db"));
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let (mut store, recovered) = match Store::open_or_recover(&db_path) {
                Ok(ok) => ok,
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
            if store.attach_saved_vault().is_err() {
                eprintln!("vault mirror setting unreadable; mirroring stays off");
            }
            let _ = LIBRARY_DB.set(db_path.clone());
            Store::mark_session_open(&db_path);
            let reader =
                Store::open_reader(&db_path).map_err(|e| format!("cannot open reader: {e}"))?;
            let analyst =
                Store::open_reader(&db_path).map_err(|e| format!("cannot open analyst: {e}"))?;
            app.manage(AppState {
                store: Mutex::new(store),
                reader: Mutex::new(reader),
                analyst: Mutex::new(analyst),
            });
            app.manage(CaptureMetrics::default());
            app.manage(start_vault_flusher(app.handle()));
            app.manage(start_agent_watcher(app.handle(), db_path.clone()));
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let _ = mirror_attachments(&handle);
                    request_vault_flush(&handle);
                });
            }
            if recovered {
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

            refresh_icon_cache_if_updated(&dir);

            let settings_item =
                MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
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
                "toggle_sticky" => {
                    let _ = app.emit_to("library", events::MENU_TOGGLE_STICKY, ());
                }
                "quit" => request_quit(app),
                _ => {}
            });

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
                    "quit" => request_quit(app),
                    _ => {}
                })
                .build(app)?;

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
                    let handle = library.app_handle().clone();
                    library.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            handle.exit(0);
                        }
                    });
                    let _ = library.set_focus();
                }
            }

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
            count_notes,
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
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !QUIT_READY.load(Ordering::Acquire) {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
            tauri::RunEvent::Exit => close_session(),
            _ => {}
        });
}
