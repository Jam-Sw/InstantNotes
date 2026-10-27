use instantnotes_core::types::*;
use instantnotes_core::Store;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
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
    request_vault_sync(app);
}

fn emit_tags_changed(app: &AppHandle) {
    let _ = app.emit(events::TAGS_CHANGED, ());
    request_vault_sync(app);
}

fn emit_workspaces_changed(app: &AppHandle) {
    let _ = app.emit(events::WORKSPACES_CHANGED, ());
    request_vault_sync(app);
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
use shell::menu::{install as install_menus, run_command};
use shell::{
    agents::*, backups::*, capture::*, diagnostics::*, files::*, mirror::*, quit::*, server::*,
    stickies::*, update::*, windows::*,
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
            show_painted_library(app.handle(), &dir);
            std::fs::create_dir_all(&dir)?;
            shell::log::init(&dir);
            install_panic_hook(&dir, env!("CARGO_PKG_VERSION"));
            let db_path = std::env::var_os("INSTANTNOTES_DB_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| dir.join("instantnotes.db"));
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let restored = apply_restore_at_launch(&db_path);
            let (mut store, recovered) = match Store::open_or_recover(&db_path) {
                Ok(ok) => ok,
                Err(e) if e.is_schema_too_new() => {
                    let handle = app.handle().clone();
                    if let Some(library) = app.get_webview_window("library") {
                        let on_close = handle.clone();
                        library.on_window_event(move |event| {
                            if let tauri::WindowEvent::CloseRequested { .. } = event {
                                on_close.exit(1);
                            }
                        });
                    }
                    app.dialog()
                        .message(
                            "This notes library was created by a newer version of \
                             InstantNotes. Update the app to open it.",
                        )
                        .title("Library too new")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Update".into(),
                            "Quit".into(),
                        ))
                        .show(move |update| {
                            if update {
                                run_command(&handle, "app.checkUpdates");
                            } else {
                                handle.exit(1);
                            }
                        });
                    return Ok(());
                }
                Err(e) => return Err(format!("cannot open store: {e}").into()),
            };
            if matches!(restored, Some(Restored::Done(_))) {
                finish_restore(&mut store);
            }
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
            app.manage(LinkedImageState::default());
            app.manage(ServerLink::default());
            app.manage(start_vault_sync(app.handle()));
            app.manage(start_agent_watcher(app.handle(), db_path.clone()));
            start_backups(app.handle());
            {
                request_vault_sync(app.handle());
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

            if let Some(restored) = restored {
                announce_restore(app.handle(), restored);
            }

            refresh_icon_cache_if_updated(&dir);

            install_menus(app)?;

            let shortcut_failure = register_shortcut(app);
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
            set_tag_color,
            delete_tag,
            add_tag_to_note,
            remove_tag_from_note,
            tags_for_note,
            list_workspaces,
            get_or_create_workspace,
            rename_workspace,
            set_workspace_color,
            set_workspace_flag,
            workspace_tag_slices,
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
            open_data_folder,
            request_quit,
            set_window_vibrancy,
            set_window_theme,
            export_theme_file,
            import_theme_file,
            export_note_file,
            sheet_csv,
            save_attachment,
            get_attachments_dir,
            import_image_file,
            allow_linked_images,
            pick_linked_image,
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
            list_backups,
            backup_now,
            set_backups_automatic,
            inspect_backup,
            restore_backup,
            open_backups_folder,
            report_frontend_error,
            list_crash_reports,
            read_crash_report,
            delete_crash_report,
            diagnostics_report,
            get_vault_status,
            set_vault_folder,
            verify_vault,
            confirm_vault_removals,
            get_sync_server_status,
            connect_sync_server,
            cancel_sync_sign_in,
            confirm_recovery_saved,
            show_recovery_key,
            start_sync_join,
            enter_recovery_key,
            accept_plain_server,
            disconnect_sync_server,
            confirm_sync_join,
            list_sync_join_requests,
            list_sync_devices,
            revoke_sync_device,
            answer_sync_join,
            confirm_sync_removals,
            set_sync_encryption,
            get_merge_review,
            settle_merge_pair,
            undo_merge_combine,
            clear_merge_review,
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
            capture_targets,
            capture_append,
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
            list_agent_scratch,
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
                    begin_quit(app);
                }
            }
            tauri::RunEvent::Exit => close_session(),
            _ => {}
        });
}
