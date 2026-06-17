# Change: Tauri Conformance Hardening and Library Page Decomposition

## Why
A best-practice audit of the desktop shell against the Tauri v2 documentation
found several divergences that cost responsiveness, dependability, and native
feel. Every IPC command ran synchronously on the main thread, so a slow SQLite
query could stall the UI. The store set no busy timeout even though a dev build
and the installed release share one database file, so a competing writer surfaced
as a hard "database is locked" error. Nothing stopped a second launch from
starting a rival process with its own tray and database writer. The tray showed
the full-color app icon instead of a menu-bar template, so it never adapted to
light or dark. Raw `open` subprocesses bypassed the permission system, and there
was no release build profile.

Separately, the library window had grown into a single 1097-line component
covering the layout, three panes, the format toolbar, the welcome screen, global
keyboard handling, and roughly 500 lines of CSS. That god-component is the real
maintenance liability, the opposite of the over-scoping found elsewhere.

This change hardens the shell to match the documentation and decomposes the
library page, while folding in the in-progress editor and updater refinements and
the dev harness that the single-instance work required.

## What Changes
- Run the data and filesystem IPC commands off the main thread with
  `#[tauri::command(async)]`; the trivial window commands stay synchronous.
- Open the SQLite store with a 5s busy timeout and `synchronous=NORMAL` alongside
  WAL, so a second process waits for the writer instead of failing with
  SQLITE_BUSY.
- Add `tauri-plugin-single-instance`, registered first: a second launch surfaces
  the running window instead of starting a rival process.
- Quit dev builds on window close (release still hides to tray) so a hidden dev
  process never traps a single-instance relaunch in a stale webview.
- Replace the raw `open` subprocess with `tauri-plugin-opener` for the repo link
  and data folder; harden the theme-file commands to reject non-absolute or
  non-`.json` paths.
- Give the tray a monochrome template icon (`icons/tray.png`, `icon_as_template`)
  so the menu bar tints it for light and dark.
- Add the recommended `[profile.release]` (lto, opt-level=s, strip, panic=abort);
  scope the dialog capability to the library window only; set
  `minimumSystemVersion` to 11.0.
- Decompose `src/routes/+page.svelte` (1097 to 179 lines) into Sidebar, NoteList,
  NoteEditor, FormatToolbar, BulkActions, and WelcomeScreen, with shared
  date, preview, and word-count helpers in `src/lib/format.ts`. Behavior is
  preserved.
- Fold in the editor and updater refinements: tree-driven active-mark detection
  for the format toolbar (`markdown-active.ts`), the snooze-aware updater and
  richer update panel, and a dev harness (`scripts/tauri-dev.mjs`,
  `tauri.dev.conf.json`, a dev build badge, `INSTANTNOTES_DB_PATH`).

## Impact
- Shell: `src-tauri/src/lib.rs` (async commands, single-instance, opener, tray
  template, dev and release window lifecycle), `src-tauri/Cargo.toml` (plugins,
  features, release profile), `capabilities/`, `tauri.conf.json`.
- Core: `instantnotes-core` `store.rs` gains the busy-timeout and synchronous
  pragmas plus a pragma test; the domain logic is untouched.
- Frontend: the new pane components and `format.ts`; the editor active-mark
  module; the updater store, panel, and snooze; the dev launcher, dev config, and
  layout badge.
- Behavior: the page decomposition is behavior-preserving (verified). New
  user-visible behavior is the single-instance guard, the template tray icon, and
  the dev-only quit-on-close.
