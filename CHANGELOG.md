# Changelog

All notable changes to InstantNotes are recorded here. The section for each
release becomes the GitHub release notes and the "What's new" text shown by the
in-app updater, written for users. Newest first.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the app
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.4]

### Added
- Agents: `edit_note` replaces one exact `oldText` that appears once in a document.
- Agents: `search_notes` takes `detail: "titles"` and `status` `pinned` or `trash`; `get_note` takes `maxChars` and `bodyOffset`; `suggest_space` takes `offset`.
- Sheet notes: a third kind of note, a cell grid that stays a note. New sheet
  from the palette, the ＋ menu, or File > New Sheet. It works like Sheets or
  Excel: type into a cell, Tab across, Enter down (a new row appears at the
  bottom), copy and paste ranges to and from Google Sheets, Excel, and
  Numbers, undo and redo, resize columns, insert and delete rows and columns
  from the header menus. A sheet is listed, tagged, filed, searched, popped
  out as a sticky, and exported like any note; its cells are its text, so
  `#tags` typed into cells tag the note. In the vault it is a Markdown table
  with a `.csv` beside it; Export Note writes the `.csv`. Agents get
  `append_sheet_rows` to log rows into a sheet, and rows an agent adds appear
  in the open grid without a reload, beside anything still being typed.
- Graph: 3D layout (`d3-force-3d`, held to a slab by `forceZ`, Barnes-Hut
  `theta` 1.2); right-drag, Shift+drag or arrow keys turn it about the framed
  nodes, drawn in perspective back to front. Pan, zoom and lens unchanged.

### Changed
- Agents: writes return the note without its body; `get_note` and `get_notes` cut bodies at `maxChars` (12,000, 60,000 shared per `get_notes`).
- Agents: `search_notes` defaults to 10 results, refuses an empty query, and returns a `hint` on no match; every page echoes `limit`.
- Agents: `create_note` and `add_to_space` return `createdSpace`; resource reads are traced; a sheet's view returns `sheet.header`.
- Graph: labels never overlap: placed by priority (open note, hovered, lit,
  hubs by degree, nearest) under or else over their node (`rbush`), above all nodes.

### Fixed
- Updater: the installed-update note offers "Restart now" (`restart_app`: quit
  handshake, then `request_restart`); closing the window only hid to the tray,
  so the old version kept running.

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
