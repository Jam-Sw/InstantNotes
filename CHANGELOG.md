# Changelog

All notable changes to InstantNotes are recorded here. The section for each
release becomes the GitHub release notes and the "What's new" text shown by the
in-app updater, so write it for users. Newest first.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the app
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0]

### Added
- The Settings front page is now a dashboard: live counts for your notes, tags,
  Spaces, and attachments, the capture readiness time, and the release notes for
  the version you are running.
- An Images settings page: choose whether an added image is copied into
  InstantNotes or linked from its original file, set how tall images preview,
  and see where attachments live with a button to open the folder.
- Insert an image from a file with the Image button in the editor toolbar, in
  addition to pasting or dropping one.
- An Editor settings page with a "Show exact save time" option; the exact save
  time, to the minute, is always available on hover over any note's date.
- Contexting can rewrite images to their absolute path (the new default), keep
  the reference as written, or drop images entirely when you copy a note as
  context.
- Send feedback from inside the app: the new Feedback page files a bug or idea,
  saves a copy on your machine, and opens a prefilled GitHub issue.

### Fixed
- A stray caret no longer lingers in notes you switch between: each note now
  loads with its own clean editing state, and undo no longer reaches back into
  the previously open note.
- Links set to open with Cmd/Ctrl+Click now show the pointer cursor while the
  modifier is held, so it reads as clickable.

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
