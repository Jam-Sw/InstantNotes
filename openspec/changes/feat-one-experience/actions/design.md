# Design: Every action has two homes

Shared design §1 is the rule. This unit builds it into the code and uses it
for the first feature the owner asked for: Check for updates, easy to reach.

## 1. One registry, one event

`src/lib/commands.ts` already builds the palette's commands from the stores.
It becomes the registry every surface runs from:

- A new store, `src/lib/stores/shell.svelte.ts`, owns what `+page.svelte`
  kept in local state: `settingsOpen`, `settingsPage`, `paletteOpen`, with
  `openSettings(page?)`, `closeSettings()`, `togglePalette()`. Commands can
  then open a Settings page directly, on every platform.
- `runCommand(id)` in `commands.ts`: builds the commands, finds the id, runs
  it; a command that is not available right now (no note selected, the
  licence lock on) is a no-op. This is what the menu event calls.
- The shell emits `menu:command { id }` for every menu and tray item. The
  Rust side keeps one function, `run_command(app, id)`, which shows the
  library window and emits the event. Menu item ids are command ids.
- The "library too new" dialog's Update button and the tray's Check for
  Updates both run `app.checkUpdates` this way; `updater:check` goes.
- `settings:open` goes: the menu's Settings item runs `view.settings`, and
  the web palette's Open settings calls the shell store directly.

The contract test (`src/lib/api/contract.test.ts`) holds the two event
registries equal; both lose six names and gain one.

## 2. Commands added

| Command | Where | Does |
| --- | --- | --- |
| `view.settings` | all | Opens Settings (`Mod+,`) |
| `view.palette` | all | Opens the palette (menu shortcut `Mod+K`) |
| `view.zoomIn`, `view.zoomOut`, `view.zoomReset` | all | The editor zoom (menu View) |
| `app.checkUpdates` | desktop | `updater.checkNow({ manual: true })`; a found update opens the Update Space |
| `app.showUpdate` | desktop, while an update is pending | Opens the Update Space |
| `app.sendFeedback` | desktop | Settings > Feedback |
| `app.openRepo` | all | The repository in the browser |
| `app.openDataFolder` | desktop | Reveals the app data folder |
| `app.quit` | desktop | Quit, through the quit handshake |
| `note.export` | desktop, note selected | Export Note As (was a menu-only action) |
| `view.about` | all | Settings > About; the Help menu's About on Linux and Windows |
| `app.openChangelog` | all | The full CHANGELOG on GitHub |

Three ids the shell runs itself, so they work before the page loads:
`app.quit` (the quit handshake), `app.capture` and `app.library` (tray only).
`SHELL_ONLY` in `menu.rs` names them. The palette's `app.quit` calls the new
`request_quit` command, which starts the same handshake.

Keys the page handles (palette, sidebar, agents, zoom) keep their handlers
and their menu items carry no native accelerator, so a key never fires twice
and the whiteboard keeps its own zoom; the palette shows the shortcut. Keys
the menu owned in 0.10.0 (new note, new whiteboard, sticky, Settings, Quit)
stay native accelerators; on the web, `Mod+,` is handled by the page.

`app.sendDiagnostics`, `data.*` and `note.openElsewhere` arrive with their
units.

## 3. The menus

Desktop app menu: **File** (New Note, New Whiteboard, New Sheet, Pop Out as
Sticky, Export Note As, Settings on Linux and Windows, Quit on Linux and
Windows), **Edit** (the predefined items), **View** (Command Palette, Show
Graph, Show or Hide Sidebar, Show Agents, Zoom In, Zoom Out, Actual Size),
**Help** (Check for Updates, Send Feedback, Send Diagnostics, Repository on
GitHub, Open Data Folder; About on Linux and Windows, where there is no app
menu). The macOS app menu keeps About, Settings, Services, Hide, Quit.

Tray: New Capture, Open Library, Check for Updates, Settings, Quit. The
Settings submenu of 0.10.0 goes; its two links live in Settings > About.

## 4. Settings > About

- Version, with the platform read from the runtime: macOS, Windows, Linux,
  iPadOS, iOS, or "Web app" with the server's version (`/sync/v1/info`).
  0.10.0 printed "macOS · Apple Silicon" on every platform.
- **Updates** (desktop): one status line (Up to date, checked <time> /
  Update available: v<x> / Checking / Last checked: never / Couldn't check),
  **Check for updates** and, while pending, **Show update**. The last check
  is kept in `updates.lastCheckedAt` so it shows across launches.
  On the web: "The web app updates with your server" and the server version.
  On iOS and iPadOS later: the App Store page.
- Links: Repository, Full changelog, Open data folder (desktop), Send
  feedback (desktop).

## 5. The visible prompt

When an automatic check finds an update, a toast says "InstantNotes v<x> is
available" with **Show** (the Update Space) and stays until dismissed; once
per version per launch. A manual check that finds one opens the Space at
once, as 0.10.0 did. The Update Space in the sidebar and the welcome screen's
pill stay; the toast is what someone with a note open sees.

`toasts.show` gains an optional duration; `Infinity` keeps a toast until it
is dismissed or its action runs.

## 6. Tests

- `commands.test.ts`: `runCommand` runs a known id, ignores an unknown one,
  and does nothing while the licence lock is on.
- `updater.svelte.test.ts`: the toast on an automatic find, once per
  version; `lastCheckedAt` written on every finished check.
- `SettingsAbout.test.ts`: the platform line per runtime; the Updates group
  per updater status; the buttons call the store.
- `toasts.svelte.test.ts`: an `Infinity` toast does not auto-dismiss.
- The contract test over the event registries.
- `src-tauri`: a unit test that every menu and tray id is a known command
  (the Rust side lists the ids it emits; the TypeScript test reads that list
  from `src-tauri/src/shell/menu.rs` and checks each against `buildCommands`).
