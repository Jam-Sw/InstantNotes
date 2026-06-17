# Tasks

- [x] Run data and filesystem IPC commands off the main thread with #[tauri::command(async)]
- [x] Open the SQLite store with a 5s busy timeout and synchronous=NORMAL; unit-test the pragmas
- [x] Add tauri-plugin-single-instance, registered first, surfacing the running window
- [x] Quit dev builds on window close; release keeps hiding to the tray
- [x] Replace the raw open subprocess with tauri-plugin-opener; harden theme-file path validation
- [x] Give the tray a monochrome template icon and set icon_as_template
- [x] Add [profile.release]; scope the dialog capability to the library window; set minimumSystemVersion 11.0
- [x] Decompose +page.svelte into Sidebar, NoteList, NoteEditor, FormatToolbar, BulkActions, WelcomeScreen
- [x] Extract shared date, preview, and word-count helpers into lib/format.ts with tests
- [x] Fold in editor active-mark detection, the snooze-aware updater and panel, and the dev harness
- [x] Verify: svelte-check, npm test, cargo test --workspace, and the production build pass
