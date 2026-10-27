# Changelog

All notable changes to InstantNotes are recorded here. The section for each
release becomes the GitHub release notes and the "What's new" text shown by the
in-app updater, written for users. Newest first.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the app
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Space and tag colours: right-click a space or tag to pick a swatch from the theme's palette (every
  theme carries one) or any `#rrggbb` colour, and right-click a space to show its flag. Settings >
  Appearance chooses how a space is marked (Color, Flag or Both) with live previews, and a space's marker shows the
  share of its tags as slices. Colours and flags travel through folder sync and the sync server.
  Commands `set_tag_color`, `set_workspace_color`, `set_workspace_flag` and `workspace_tag_slices`; MCP
  `list_tags` and `list_spaces` report the colour, `list_spaces` the flag.
- Copy context: right-click a note, or a selection of notes, to copy it for an agent, including from the
  Trash. A source line names the copy time and the note id that MCP `get_note` reads, live or trashed;
  Settings > Contexting previews it on the selected note and explains every template variable
  (`contexting.sourceLine` turns it off). A refused clipboard write says so.
- Layouts for every window width: large from 1200 px shows the sidebar, the note list and the editor;
  expanded from 840 px keeps the sidebar inline while the editor keeps 420 px and drops it into a drawer
  below about 940 px; medium from 600 px shows the editor with the list as a drawer; compact stacks the
  list and the editor behind a back button. Large and expanded remember their own choice
  (`layout.large`, `layout.expanded`), and the sidebar and the list hide separately.
- Drag dividers for the sidebar and the note list: double-click resets, arrow keys move 16 px, and a drag
  past half the minimum hides the pane. Widths are saved (`layout.navWidth`, `layout.listWidth`).
- With the note list hidden, the welcome screen is a finder: the same search field, the first six
  results in place, the five notes opened last when nothing is typed, arrow keys and Enter, and Show all
  in the note list.
- Cmd or Ctrl+Shift+F (Search notes) puts the cursor in search, showing the list if it is hidden; the
  View menu gains Show or Hide Note List (Cmd or Ctrl+Shift+L) and Search Notes beside Show or Hide
  Sidebar (Cmd or Ctrl+\). Ctrl+Cmd+S also toggles the sidebar on a Mac, and Escape closes an open drawer.
- Restore on a trashed note's right-click menu, for the note or the whole selection.
- Search to write: in the note list's search field the arrow keys move through the notes, and Enter
  opens the first result (or the open note) with the cursor in its body. When nothing matches, Start a
  note starts one whose first line is the search, in the list and the welcome finder; Enter creates
  nothing.
- Empty lists say what belongs there and offer the next step: New note in an empty library, space or
  tag, Show the whole space when a tag slice inside a space is empty.

### Changed
- A new note, from the + button, Cmd or Ctrl+N, the menu or the palette, opens with the cursor in its
  body, and Enter in a note's title moves the cursor to the body.
- Search results open with a count, and the first result is marked while the search field has the
  cursor. The search field is the height of the + control beside it.
- Panes slide with their content when they show or hide, and snap while the window is being resized,
  as a native split view does.
- The library schema is version 16 (space colour and flag). Once 0.11 opens a library, 0.10 refuses it
  as too new.

## [0.10.1] - 2026-10-15
### Added
- Settings > About: the real platform, the last update check (`updates.lastCheckedAt`), Check for updates
  and Show update; the web app shows its server's version.
- An update found by an automatic check shows a toast with Show that stays until dismissed, once per
  version per launch. `toasts.show` takes a duration; `Infinity` keeps the toast.
- Commands `view.settings`, `view.about`, `view.palette`, `view.zoomIn`, `view.zoomOut`, `view.zoomReset`,
  `app.checkUpdates`, `app.showUpdate`, `app.sendFeedback`, `app.openRepo`, `app.openChangelog`,
  `app.openDataFolder`, `app.quit`, `note.export`; the palette offers them on every platform they apply to.
- Menus File, Edit, View and Help; the tray offers New Capture, Open Library, Check for Updates, Settings
  and Quit.
- The formatting toolbar: undo and redo, a heading cycle (`heading` in `markdown-format.ts`), icons for
  every tool, an image button on the desktop, a Markdown source toggle and zoom, in one row above the note.
- `editor.sourceMode` (the Markdown marks shown) is its own setting; commands `view.toolbar` and
  `view.markdownSource`; Settings > Editor switches both.
- Sync: the look and editor settings (theme, light or dark, custom theme, body font, toolbar, Markdown
  source, exact times, link underline, link previews, the outside-link mark, image preview height and tag
  suggestions) follow the library to every device and the web, as one encrypted `settings` object merged
  against `sync.settingsBase`; device settings stay on the device. Event `settings:changed`.
- Sync sign-in on a computer with no browser (a container, a remote desktop): the app shows a short code and the
  server's address; open it in a browser on any other device, type the code, sign in, and allow. The confirm page
  shows the code again so you can check it matches. The app uses it when it cannot open a browser, or always with
  `INSTANTNOTES_SIGN_IN=code`. Server: `device/code`, `device/link` and `device/poll` (RFC 8628 shape, bound to
  the app's PKCE challenge).
- Server: `INSTANTNOTES_PEOPLE_DIR`, a per-person folder template with `{sub}`, `{username}`
  (`preferred_username`) and `{email}`; a 0.10.0 folder moves once on that person's next request, and a
  failed move answers 503 for that person. Unset, the layout is unchanged. `server.db` `persons` gains
  `username`, `email` and `folder`, added at start.
- Server: `instantnotes usage [--json]` (per-person bytes, blobs, objects, last seen) and
  `instantnotes check [--url <address>]`, a headless end-to-end proof of the encrypted sync path as the
  reserved person `instantnotes-check` that cleans up after itself: exit 0 `ok`, exit 1 `failed at <step>`.
- Server: `INSTANTNOTES_SIGN_IN_STYLESHEET`, an `https://` address or same-origin path of a stylesheet the
  sign-in pages load after their own (override `--bg`, `--glow`, `--ink`, `--accent`, `--accent-ink`), under
  a Content-Security-Policy that allows only its origin. The server writes only to its data folder and the
  people folders, so a read-only root needs no tmpfs.
- Diagnostics: a panic writes `crashes/crash-<stamp>.txt` and a front-end error `crashes/error-<stamp>.txt`
  beside the library; `instantnotes.log` records events and rotates at 1 MB to `instantnotes.log.1`.
  Settings > Diagnostics shows each report in full with Copy and Send (a prefilled GitHub issue in the
  browser; nothing leaves without a click); palette `app.sendDiagnostics`. `diagnostics.crashReports`
  (default off) offers new reports at the next launch; `diagnostics.lastPromptAt`. Commands
  `report_frontend_error`, `list_crash_reports`, `read_crash_report`, `delete_crash_report`,
  `diagnostics_report`. The web keeps its last 20 errors in sessionStorage (`instantnotes.errors`).
- Whiteboards open with the pen tool on phones and tablets; the first pen stroke turns on pen mode, so
  fingers pan and zoom, and a palm resting on the glass while the pen draws is ignored.
- Open on another device (`note.openElsewhere`, the first button in the editor header): a QR code and a
  link to `<sync server>/#note=<id>`, built only from the server this device is signed in to; the web app
  opens `#note=<id>` and waits up to a minute for the note to sync.
- On a phone, one pane at a time with a back button that follows the system back gesture, and the sidebar as
  a drawer with Graph, Spaces, tags and Settings; on a tablet, the list and the note side by side with the
  sidebar behind a menu button; on touch screens, finger-sized controls, safe areas, room for the on-screen
  keyboard and a command button that opens the palette (a sheet on phones). A desktop window 600 to 960 px
  wide uses the same drawer.
- The built-in theme Night console (`night-console`): amber on deep slate with square corners.
- Releases list the SHA-256 of every file of the web app the server serves in `web-code-sha256.txt`.
### Changed
- Editor: the formatting toolbar sits on the page at the width of the text, so zoom in and out stay in view in the default window, and the header's note actions step back to a quieter ink.
- The toolbar shows by default (`editor.toolbarOpen` default true, a stored false kept) and no longer
  decides the editor's mode; `Editor.svelte` exposes `undo`, `redo`, `canUndo`, `canRedo` and reports
  history through `onhistory`; `ActiveMarks` gains `heading`.
- Every menu and tray item is a command id, answered with one event, `menu:command { id }`
  (`src-tauri/src/shell/menu.rs`, `runCommand`); `settings:open`, `menu:new-note`, `menu:new-whiteboard`,
  `menu:new-sheet`, `menu:export-note`, `menu:toggle-sticky` and `updater:check` are gone.
- Shell commands `open_data_folder` and `request_quit`.
- Daily backups: `backups/instantnotes-<stamp>.db` beside the library through `VACUUM INTO` on the reader
  connection, 30 s after launch and then hourly when the newest is older than a day; kept 7 days, then one
  per ISO week for 5 weeks, then one per month for 6 months (`core::backup::keep`); `backups.automatic`.
- Settings > Backups (web: Export): Automatic backups, Back up now, the list with Restore, Restore from a
  file, Open backups folder, and the Markdown export moved here from Sync. Restore verifies the file,
  asks, restarts, keeps the old library as `-before-restore.db`, turns sync off (`Store::detach_sync`).
- Commands `list_backups`, `backup_now`, `set_backups_automatic`, `inspect_backup`, `restore_backup`,
  `open_backups_folder`; event `backups:changed`; palette `data.backups`, `data.export`, `data.backupNow`.
- Web export: `vault::archive` writes a stored `.zip` (no dependency) of the vault files plus
  `attachments/`; the worker's `export_archive()`; the page downloads `InstantNotes-<date>.zip`.
- Server image: OCI labels (`title`, `description`, `source`, `url`, `documentation`, `licenses`, `vendor`;
  `version`, `revision`, `created` set by the release job), so the GHCR package page links the repository.
- Graph: a drag turns the view around its centre, marked by a small cross; right-drag, Shift+drag,
  middle-drag, two fingers and a trackpad's two-finger scroll pan; the mouse wheel, Ctrl+wheel and pinch
  zoom; double-click or double-tap a node to turn around it; double-click the background, Home, 0 or Reset
  view to go back. A ground ring and an upright ring stay fixed in the world, farther nodes fade, and
  labels keep one size: tags and Spaces always, the open, centred or hovered node and its neighbours.
  A single click opens a node after 300 ms, so a double click can centre it.
- On Linux with no system keychain (no Secret Service), the sign-in token and library key are kept in
  `secrets.json` next to the library, readable by its owner only, instead of sign-in failing. macOS and Windows
  keep using the system keychain only.
- A browser that fails to open no longer ends sync sign-in; the code sign-in takes over.
- Releases build on GitHub-hosted runners (`ubuntu-22.04`, `windows-latest`, `macos-latest`); the server
  image is multi-arch (`linux/amd64`, `linux/arm64`) and a failed image keeps the release a draft.
- macOS builds are signed and notarized when `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are set, ad-hoc signed
  otherwise; Windows builds are signed with Azure Trusted Signing when `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT` and
  `AZURE_SIGNING_PROFILE` are set. The release notes' first-install text follows what was signed.
- Dependencies: the cargo and npm groups from dependabot #79 and #75 (tauri 2.12.2, rand 0.10, base64
  0.23, similar 3, Svelte 5.57.2, Vite 8.3.4 and the rest); SvelteKit stays on 2, TypeScript on 6 and
  sqlite-wasm-vfs on 0.2, whose next majors need a migration of their own.
### Fixed
- Server: a fresh Docker named volume at `/data` works; the image now ships `/data` owned by uid 1000, where 0.10.0 stopped with "cannot protect library folder".
- Sync: a device that needs the library key asks for approval as soon as the Sync page shows, with the six
  words on screen, instead of waiting for "Approve on another device" (desktop and web).
- Sync: an approval request brings the library window forward on a device that has the key, so it no
  longer waits unseen in a window closed to the tray.
- Sync: after a restart while waiting for approval, the Sync page asks again instead of staying blank.
- Sync: the recovery key can be typed while waiting for approval; it withdraws the request.
- Sync: on the desktop, a failed check for an approval (the network or the server briefly away) retries
  instead of reporting the request as not approved; only a refused or expired request ends the wait.

## [0.10.0] - 2026-10-12
### Added
- Vault sync: the vault folder is read back (`Syncer::cycle`: pull, scan, ingest, removals, manifest merge,
  flush, attachments, push; 5 s poll), so devices sharing one folder (network drive, Syncthing) stay in step;
  `Transport` trait, `Folder` the first.
- Sync conflicts keep both versions: the other becomes `<title> (conflict <date time>)` tagged `conflict`;
  `instantnotes.yaml` merges per key against `vault.manifestBase`.
- Web mode: new sign-in page (`statics::SIGN_IN`); after sign-in `statics::signed_in` hands off to the app.
- `confirm_vault_removals`, `vault:synced { noteIds }`; `get_vault_status` adds `transport`, `reachable`,
  `unreachable`, `lastSyncedAt`, `heldRemovals`, `conflicts`.
- Sync server: `vault.transport = "server"` syncs the library through `instantnotes-server` (`/sync/v1`): each
  note, the manifest and each attachment is one object, committed against its base; `409` pulls and keeps both.
- End-to-end encryption, on by default: objects are age-encrypted to the library key, padded, under HMAC names;
  the server holds no key. `set_sync_encryption` switches a library over (`POST switch`), proven by a marker.
- Desktop sign-in through the server (loopback redirect, PKCE, `device/token`); device tokens and the library key
  in the system keychain; new devices approved by six words over both keys (`keys/requests`).
- Joining a library that has notes asks first (`confirm_sync_join`); exact copies combine undoably, likely pairs
  go to the "Review merge" Space (`get_merge_review`, `settle_merge_pair`, `undo_merge_combine`).
- Web app: the core runs in a browser worker (`src-tauri/web`, SQLite in OPFS) with its own encrypted copy, images
  in the database, a service worker for offline use, one tab at a time. Not laid out for phones yet.
- Server: `GET /healthz` checks `server.db`; HSTS; rate limits on sign-in and sync; `INSTANTNOTES_TRUST_PROXY`,
  `INSTANTNOTES_MAX_OBJECT_MB`.

### Changed
- Vault flush defers instead of overwriting a note file changed since its `file_sha`; the vault needs
  `instantnotes.yaml` present (`set_vault_folder` creates it), so an empty mount point pauses sync.
- A file deleted from the folder trashes its note here; more than half the library (over 20) at once is held
  for `confirm_vault_removals`.
- Web mode: the server no longer holds a readable library: `POST /api/<command>` and `/api/events` are removed,
  the browser runs its own copy; a 0.9.5 web library moves into the first device that syncs (`GET legacy`,
  imported, pushed, then `DELETE legacy`).

### Fixed
- Server: the OIDC `id_token` signature is verified against the provider's `jwks_uri` (issuer, audience, `azp`,
  nonce, expiry); before, its claims were decoded unchecked.

### Security
- Server: every signed-in person is re-checked hourly with a stored refresh token; `invalid_grant`,
  `access_denied` or `invalid_request` (400/401/403) revokes their devices and sessions, data kept.

## [0.9.5] - 2026-10-10
### Added
- `instantnotes serve`: a headless web mode (no window, no Tauri) serving the UI and a `POST /api/<command>`
  allow list, an SSE change stream at `/api/events`, OIDC sign-in (PKCE, `/auth/login`, `/auth/callback`,
  `/auth/logout`) and one library per `sub` under `INSTANTNOTES_DATA_DIR/libraries/<sub>/`, closed after 10 min
  idle. Configured by `INSTANTNOTES_LISTEN`, `_DATA_DIR`, `_PUBLIC_URL`, `_OIDC_ISSUER`, `_OIDC_CLIENT_ID`,
  `_OIDC_CLIENT_SECRET`, `_UI_DIR`.
- Release workflow builds and pushes `ghcr.io/jam-sw/instantnotes-server:<version>` (`Dockerfile`, distroless,
  uid 1000, read-only root).
- Web UI: `call()` posts to `/api/<command>` and `listen()` reads the SSE stream when the page carries
  `<meta name="instantnotes-runtime" content="web">`; stickies, vault, agents, feedback, updater, file dialogs
  and window commands are hidden there. License acceptance is stored in the person's library.

### Fixed
- "Library too new" offers Update (opens the in-app updater) or Quit instead of exiting on OK; closing the
  window quits.

## [0.9.4] - 2026-10-09
### Added
- Sheet notes: a third note kind, a cell grid (Tab/Enter entry, range paste to and from Sheets, Excel and
  Numbers, undo, resizable columns). Stored in the vault as a Markdown table plus a `.csv`.
- Agents: `edit_note` replaces one exact `oldText` that occurs once; `append_sheet_rows` adds rows to a sheet.
- Agents: `search_notes` takes `detail: "titles"` and `status` `pinned`/`trash`; `get_note` takes `maxChars`
  and `bodyOffset`; `suggest_space` takes `offset`.
- Agents: Settings > Agents sets per-kind tags for every note an agent creates, and Block, which refuses all
  of that agent's calls.
- Agents: an agent's page shows a clock-in punch card, keeps a reconnect under the same session as one
  conversation, and offers "End session".
- Agents: a note an agent last changed shows "Last changed by" and the agent's name in the editor, and a
  ring in the graph.
- Graph: 3D layout (`d3-force-3d`, `forceZ` slab, Barnes-Hut `theta` 1.2); right-drag, Shift+drag or the
  arrow keys rotate it.
- Notes: one-tap tag suggestions from the note's own words; Settings > Editor sets Eager, Balanced, Careful
  or off.
- Notes: a link dropped from a browser becomes a Markdown link with the page title.
- Capture: recent notes are listed under the box; Tab picks one and Enter appends the capture to it.
- Capture (Linux, Wayland): the welcome screen says the global shortcut fires only while an X11 app is
  focused, and suggests binding `instantnotes capture`.
- Settings: search lists every matching setting across all pages.
- Sidebar: with many Spaces, the six largest plus the open one show, and a "more" row opens the rest.

### Changed
- Speed at 20,000 notes: note list 79 ms to 3 ms, tag and Space lists 3 s to 30 ms, filing suggestions 5 s
  to 2 s on their own read connection, so saves and searches never wait for them.
- Search: one- to three-letter prefixes are up to 7x faster via a prefix index; the library re-indexes once
  on first launch (about 3 s at 20,000 notes). Results are unchanged.
- Startup: the first screen loads a quarter of the JavaScript; the editor, Settings and the Graph load just
  after launch.
- Theme: saved colors apply before first paint; on Linux and Windows the window opens in the theme's
  background instead of white.
- Updater: the first automatic check runs 8 s after launch; "Check for updates" stays immediate.
- Saves no longer wait on the agent connection check, and large vault writes are split into smaller pieces.
- Integrity scan: libraries over 4 MB are scanned only after an unclean exit, a read error, a week, or on
  first open; smaller ones at every launch.
- Agents: writes return notes without bodies; `get_note`/`get_notes` cap bodies at `maxChars` (12,000;
  60,000 shared per `get_notes`).
- Agents: `search_notes` defaults to 10 results, refuses an empty query, returns a `hint` on no match and
  echoes `limit`; its results carry `kind`.
- Agents: `create_note` and `add_to_space` return `createdSpace`; resource reads are traced; a sheet's view
  returns `sheet.header`.
- Agents: `INSTRUCTIONS`, tool descriptions and refusals rewritten: a new thought is a new note via
  `create_note`, and each refusal names the next step.
- Graph: labels never overlap; they are placed by priority under or over their node (`rbush`), above all
  nodes.

### Fixed
- Updater: the installed-update note offers "Restart now" (`restart_app`); closing the window only hid it to
  the tray, so the old version kept running.
- Layout: below 960 px the sidebar hides, and its toggle brings it back over the list.
- Editor: wrapped list items hang under their text; in a narrow editor the title shrinks and shows in the
  top bar.
- Spaces and filters: switching keeps the open note when it is also in the new view.
- Graph: labels are cut at 28 characters and kept off other nodes unless open, hovered or lit; the side
  panel has a solid background and darker small text.

## [0.9.3] - 2026-10-02

### Added
- Graph: the graph now says where your unfiled notes belong. Beside the
  drawing, a list names each note in no Space, the Space it most likely
  belongs to, how sure the app is, and why ("because #pasta, simmer, ragu").
  One tap files it, with Undo; "Not this" keeps that Space from being
  suggested for that note again, also with Undo. Nothing is trained and
  nothing leaves your machine: the model is your library, recounted every
  time, so filing a note is what teaches it. Suggestions start once two
  Spaces hold notes, and the Graph row in the sidebar counts them.
- Graph: a tag written in a note and a tag added to it draw as different
  lines (solid and dotted), a suggested Space as a dashed one, and a legend
  names each. When a note is open the graph frames that note, its tags and
  Spaces, and the notes they gather; "Show all" is the way out.
- Agents: a read-only `suggest_space` tool answers "where does this note
  belong, and why" from the same model the Graph shows, so an agent that
  files notes can use it instead of guessing. It never files anything.

### Fixed
- Notes: a long title wraps inside the reading column instead of being clipped
  at its edge; the title is an auto-sized `<textarea>`, Enter still commits.
- Updater (Windows): `install_update` runs the quit flush before the installer
  hand-off's `process::exit`, so a debounced edit is no longer dropped.
- Errors: a save that loses the version race 3 times, or a revert of a reverted
  row, no longer says "That name is already in use"; `CONFLICT` copy is per caller.

## [0.9.2] - 2026-10-02

### Fixed
- Updater (Linux): an AppImage in a root-owned dir no longer fails with
  `Permission denied (os error 13)`; `install_update` falls back to `pkexec` (#64).
- Agents: connect snippets name `$APPIMAGE`, not the `/tmp/.mount_*` binary
  that broke MCP configs with `ENOENT` after a restart; re-copy the snippet.
- Stickies (Linux, Windows): no bare File/Edit menubar above a sticky or the
  capture panel; off macOS the app menu is set on the library window only.

### Upgrading from 0.9.0 or 0.9.1 on Linux
- If this update fails with `Permission denied (os error 13)`, install it once
  by hand; later updates prompt for the password:
  `sudo install -m 755 ~/Downloads/InstantNotes_<version>_amd64.AppImage "$(readlink -f "$(command -v instantnotes)")"`

## [0.9.1] - 2026-10-02

### Added
- Agents: a full trace of every call an agent makes lives in an Agents Space
  in the sidebar, one note per conversation (⌘⇧A, or "Show Agents" in the
  palette). Each row says who, what, and how long it took, and unfolds to the
  raw request and response exactly as they crossed MCP. Every change an agent makes can be reverted from there, and
  from the toast that announces it; a revert can itself be undone.
- Agents: the Agents row in the sidebar shows how many agents are connected
  right now, and pulses while one is in the middle of a call. Connected is
  the truth about the agent's process, including one that crashed. Each
  conversation's row says what the agent is doing this moment, then settles
  to a summary; its page has a live status line, filters for changes and
  failures, and Revert on every change's own line. Settings > Agents adds a
  connect snippet for Hermes.
- Agents: a conversation is named after its client's own session ("Claude
  Code: bob" after `/rename bob`; a Codex thread's name; a Hermes session's
  title), and its page shows the session id and the folder it runs in, so a
  change traces back to the conversation that made it. Claude Code states its
  session; Codex and Hermes do not, so theirs is matched from their own
  records and marked as a best match. Hermes is now shown as Hermes instead
  of "Mcp". Any client can state its session with `INSTANTNOTES_SESSION_ID`
  and `INSTANTNOTES_SESSION_NAME`.
- Agents: an agent's search now shows inside the search field instead of in
  a line above the note list, so the list no longer moves.
- Agents: an agent's search shows its words above your note list as it
  happens, and the notes it found light up with a dashed outline. Settings >
  Agents lets you choose which calls raise a toast (changes, everything, or
  none), shows connect snippets for Claude Code, Codex, and other apps, and
  sums up recent activity.
- Appearance: a new Settings page shows every theme as a live preview, with
  light/dark/auto, the body font, and import, export, and remove in one place.
- Three themes: Fjord (cool arctic blue), Ember (warm charcoal and amber), and
  Contrast (high contrast, larger text, firm borders).
- Claude Code plugin: search, read, and capture notes from a pane inside Claude
  Code. Install it with `/plugin marketplace add jamubc/toolbox`, then
  `/plugin install instantnotes@toolbox`; `/notes` opens the pane and
  `/note <text>` saves a note.

### Changed
- The library draws its own title bar on macOS: every pane has a header that
  moves the window, and the note's actions are icons in two groups, what goes
  into the text and what becomes of the note.
- Notes read in a centred column of readable width, with the title on the page
  and tags and Spaces in a row beneath it.
- The sidebar, note list, and page step apart in surface, every list selects
  the same way, and note rows show the date beside the title over a two-line
  snippet. On macOS the sidebar is the system's translucent material in every
  theme except Contrast.
- Dependencies: React 19, Vite 8, Vitest 5, and the Tauri plugins and Rust
  crates brought up to date.
- Settings is now a preferences window: a grouped list of pages down the left
  with a filter (type, then Enter), the page on the right, and an Overview
  with library stats, what's new, and the state of theme and agent access.
- Themes: dates, counts, and other third-tier text are legible in every
  built-in theme, light and dark. Themes can set success, warning, selection,
  code-block, and focus-ring colors; those left unset follow the palette. One
  focus ring, in the theme's focus color, for keyboard users everywhere.
- MCP: notes are also offered as `instantnotes://notes/<id>` resources for
  clients that browse them. A request that hits a bug is answered with an
  error instead of ending the connection. Tag, Space, and search lookups go
  straight to the index.
- MCP: optimized rewriting a note, 3 less tool calls.
- MCP: `search_notes` returns the matching passages with their line numbers
  and the lines around them, can match any of the words instead of all, and
  narrows by Space, tag, status, and date. `get_notes` reads several notes in
  full in one call. `search_notes` and `list_notes` say how many results
  there are in all and whether more remain. Together an agent can find what
  matters without reading, or scripting its way through, the whole library.

### Fixed
- Search: punctuation inside a word (`CachyOS/Arch`) now splits the token
  instead of being dropped; an exact title match ranks first.

## [0.9.0] - 2026-09-30

### Added
- License and EULA: on first launch they open as two notes in a License Space;
  agree to each to start. A new version of either asks again.
- Sticky notes (beta): pop any note or whiteboard out of the library into its own
  small window and put it anywhere. Or Pop Out as Sticky (⌘⇧O).
- Import Apple Stickies (Mac): Settings > Import. Colors, formatting, images,
  and dates come along; importing again brings in only new ones.
- Connect agents (Claude Code, Codex, Cursor) over MCP: Settings > Agents. Off
  until you turn it on; read only or read and write.
- See an agent at work: what it reads or edits lights up as it happens. If you
  are typing when it edits, your typing wins and you can restore theirs.
- Change Settings front page to settings dashboard + release notes reference
- Configure image settings: Modify how images behave.
- Added importing images.
- Configure UI settings: Show exact save time
- Contexting can rewrite images to their absolute path (new default)
- Send feedback from app (Github Issue) (beta)
- Vault: InstantNotes mirrors your notes as plain files in a folder you choose,
  organized by Space. Open them in any editor, on any device, even with the app
  closed. Edits sync within seconds; attachments are included and trashed notes
  go to the vault's trash folder. Use a synced folder (iCloud, Dropbox) to reach
  them elsewhere. "Check vault" verifies every file matches its note.
  Note: syncing is one-way for now, so keep editing in the app.
  "Export a copy" is still available for one-off backups.
- Whiteboards (beta): freeform canvases for boxes, arrows, frames, and sketches.
  Create one from the chevron next to + in the note list, with Cmd+Shift+N, or
  from the File menu. The command palette can convert an existing note; its text
  moves onto the board. Board text is searchable and #tags still apply. Boards
  save as standard .excalidraw files, in the vault and on export.
- Graph: a new sidebar view of how your notes, tags, and Spaces connect. It opens
  centered on the current note. Hover to highlight connections; click to open a
  note, filter by tag, or enter a Space.
- Changed update dialog into custom notification: a special "Update" Space.

### Fixed
- Images no longer pile up forever: deleting a note for good also deletes the
  images only it used. Settings > Images shows how many images no note uses any
  more and can remove them. Images used by notes in the Trash or the Archive
  are always kept.
- A stray caret no longer lingers in notes you switch between: each note now
  loads with its own clean editing state, and undo no longer reaches back into
  the previously open note.
- Links set to open with Cmd/Ctrl+Click now show the pointer cursor while the
  modifier is held, so it reads as clickable.
- Opening a notes library written by a newer version of InstantNotes no longer
  crashes the app on launch. It now shows a message telling you to update
  instead.
- A library touched by a pre-release build with the whiteboard now opens
  instead of being refused as written by a newer version, and its boards open
  as whiteboards again.
- Linux: fixed a blank or corrupted window on many systems, caused by the
  WebKit compositor. The README now lists Linux prerequisites and Arch/CachyOS
  build notes.
- The release script guards its Windows path check so cutting a release
  no longer crashes there.
- The update dialog's "Remind me later" options are gone: an update is now a
  place you can simply ignore rather than a reminder you have to silence.
- Note titles skip bold/italic markers and leading images.

### Changed
- A new app icon, New menu bar icon.
- Under the hood: error codes and event names each live in one place per side.

## [0.8.0] - 2026-07-11

### Added
- Spaces: the sidebar's collections are now Spaces, a place you go rather than
  a label you hunt for. Rename a Space in place by double-clicking it, delete
  one with an Undo toast that always keeps its notes, and narrow a Space to one
  of its tags with the chip row above the list.
- Revisit: captures you saved but never opened resurface in a Revisit view,
  oldest first, so a thought parked in a hurry comes back instead of getting
  lost. The sidebar entry appears only when something is waiting.
- The note list groups into time sections (Today, Yesterday, and so on), so a
  growing library still reads at a glance.
- Paste or drop an image straight into a note and it appears inline; the file
  is stored alongside your notes so exported markdown stays portable.
- A Links settings page controls how links in your notes look and open:
  underline always, on hover, or never; open on a plain click or with
  Cmd/Ctrl+Click; reveal a link's destination on hover; and mark links that
  leave the app.
- A resizable, collapsible sidebar: drag its edge to set the width,
  double-click the edge to reset it, and Cmd+\ (Ctrl+\ on Windows) or the
  command palette to hide and show it.
- Search results highlight what matched, in both the note title and the
  excerpt.
- The command palette opens notes: press the palette shortcut and see your
  five most recent notes, or type to search everything without leaving the
  keyboard.
- Rename or delete a tag right in the sidebar: right-click it (or press
  Shift+F10) for options, or double-click the tag to rename it in place.
- About shows a Capture readiness number: the median time from pressing the
  capture shortcut to the panel being ready to type, so the promise that
  capture stays instant is measured, not assumed.

### Changed
- Markdown preview is more dependable: it is now driven by a single pass over
  the note, so approaching or selecting formatting always reveals its markers
  before a keystroke can land, and the cursor no longer slips inside hidden
  syntax.
- Deleting is calmer: moving notes to the Trash shows an Undo toast instead
  of interrupting you, and permanent deletions ask in a proper in-app dialog
  instead of a system popup.
- The quick capture panel closes when you click elsewhere (your draft is
  kept), shows a brief "Saved" confirmation, and Cmd+Enter (Ctrl+Enter on
  Windows) saves and opens the library.

### Fixed
- Quitting can no longer lose your last moments of typing: every quit path
  saves pending edits first, and a note whose save failed says "Not saved"
  instead of pretending otherwise.
- Removing a #tag from a note's text now actually removes that tag from the
  note.
- If the notes database is ever corrupted, the app sets it aside and starts
  fresh instead of failing to launch, and tells you what happened. The
  database is also backed up automatically before any update that changes
  its format.
- Typing quickly in search can no longer show results for an older query.
- If another app owns the capture shortcut, the welcome screen now says so
  instead of the shortcut silently doing nothing.

## [0.7.0] - 2026-07-06

### Added
- Windows support: InstantNotes now ships an installer for Windows (x64)
  alongside the macOS build, both with in-app updates. On Windows the capture
  panel is summoned with `Ctrl+Shift+Space`, Settings and Quit live in the
  File menu, and shortcut labels show `Ctrl+` combinations instead of mac
  glyphs.
- Linux (early preview): an AppImage (x64) is included, but Linux support is
  still under development and may not work properly yet. The current focus is
  getting InstantNotes fully functional on macOS and Windows first.
- Settings is now a small wiki: a landing grid of category cards opening
  focused sub-pages with a breadcrumb back, including the new Contexting page.
- Contexting: a template that shapes what "Copy note as context" hands to
  other tools and AI models, with a live preview.
- List editing: Tab and Shift+Tab nest and un-nest list items in the editor.
- The native window titlebar follows the in-app light or dark theme instead of
  the launch-time system setting.

### Fixed
- Command palette rows keep the action label readable when a note title is
  long.

## [0.6.2] - 2026-06-17

### Added
- Native macOS menu bar (InstantNotes / File / Edit) with working Cut, Copy,
  and Paste, an in-place Settings view with an About tab, and a native About
  panel on the tray icon.
- Note export via File > Export Note As: save any note as a `.md` or `.txt`
  file to a location you choose.
- Creating a new note while a tag is selected in the sidebar now pre-applies
  that tag to the note, and the tag filter stays active so the note appears in
  the current view.
- WYSIWYG preview mode: closing the Aa toolbar now hides markdown syntax
  markers and renders formatting in place - bold text looks bold, italic looks
  italic, bullet points show as real bullets, and blockquotes indent with a
  left border. The note stays fully editable. Opening Aa switches back to
  source mode so you can see and edit the markers directly. Backspace at the
  start of a bullet or blockquote cleanly removes the block marker and converts
  the line to plain text.
- Command palette search now reaches into sub-menus: searching for a theme by
  name (e.g. "graphite") surfaces it directly as a "Themes" child you can
  apply in one click, without opening the theme picker first.
- Note-scoped actions in the command palette (pin, archive, delete) now show
  the note title as a breadcrumb prefix - "breakfast plan 2027 > Pin note" -
  so it is always clear which note the action will affect.
- The Graphite and Twilight themes now use a native macOS vibrancy material: on
  macOS their sidebar becomes a real translucent "Liquid Glass" panel that
  picks up what is behind the window, for a look at home on Tahoe. Every other
  theme is untouched and stays fully opaque.

### Changed
- Picking a theme in the command palette now applies it instantly and leaves
  the palette open, so you can arrow through the list and preview each theme
  live.
- Graphite has been repaletted to Apple's system colors (the macOS system blue
  accent and the system gray scale) with a slightly rounder corner radius, so
  it reads as a native macOS app even with the glass turned off.
- Each built-in theme now has its own typography and elevation: editor
  line-height and letter-spacing tuned to character (airy for Manuscript and
  Paper Dark, tight and dense for Terminal) plus overlay shadows and corner
  radii to match (flat and sharp for Terminal, a deep indigo glow for
  Twilight).

### Fixed
- Keyboard navigation in the command palette: the arrow keys no longer skip
  every other entry, and Enter and Escape now behave correctly in the theme
  picker (Escape steps back to the command list instead of closing the palette).

## [0.6.1] - 2026-06-16

### Added
- A theme picker in the command palette: press ⌘K, choose "Switch theme", and
  browse every theme in a searchable list with the active one checked.
- The format toolbar now highlights the styles your cursor is inside, so you can
  see at a glance whether the text is bold, italic, a list, a quote, and so on.
- "Remind me later" options when an update is available: snooze the reminder until
  tomorrow, next week, or the next launch instead of acting on it right away.

### Changed
- Opening InstantNotes while it is already running now brings the existing window
  to the front instead of starting a second copy.
- Notes, search, and saves run off the main thread, so the window stays responsive
  even while the database is busy.
- The menu-bar tray icon is now a monochrome template that matches a light or dark
  menu bar.

## [0.6.0] - 2026-06-15

### Added
- Live markdown styling in the note editor: bold, italic, strikethrough, inline
  and fenced code, blockquotes, lists, and links are styled as you type with the
  markers kept visible. Tags are unaffected: `#` stays a tag, never a heading.
- A format toolbar (toggled by the "Aa" button) with bold, italic, strikethrough,
  code, quote, list, and link actions, plus Cmd-B / Cmd-I / Cmd-E / Cmd-Shift-K
  shortcuts, so you can stylize text without knowing markdown.
- Editor zoom with Cmd-+ / Cmd-- / Cmd-0 and on-screen controls, persisted across
  restarts along with the toolbar state.
- In-app update panel showing the current and target version, release notes, and
  download progress, plus a "Check for Updates…" item in the tray Settings menu.
- A Saving / Saved indicator in the editor status bar.
- `npm run bump <x.y.z>` keeps the version in package.json, tauri.conf.json,
  Cargo.toml, and Cargo.lock in lockstep.

### Fixed
- The app icon now refreshes after an in-place update instead of showing the
  icon macOS had cached for the previous build.

### Changed
- Release notes now come from this changelog, and a tagged release publishes on
  a successful build instead of waiting as a draft.

## [0.5.2] - 2026-06-15

### Added
- New InstantNotes app icon.

## [0.5.1] - 2026-06-14

### Changed
- Theme selection moved out of the sidebar into the ⌘K command palette.

## [0.5.0] - 2026-06-14

### Added
- Data-driven theme engine with four built-in themes (light and dark variants)
  and portable `.intheme.json` import/export.
- ⌘K command palette for note actions and theme switching.

## [0.4.0] - 2026-06-13

### Added
- Workspaces: a two-section library to group notes by project or topic.

## [0.3.0] - 2026-06-12

### Fixed
- macOS bundle signing so the built app launches reliably.

## [0.1.0] - 2026-06-12

### Added
- Initial release: global-shortcut capture panel, notes library with SQLite
  FTS5 search, and inline `#tag` organization.
