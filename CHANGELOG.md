# Changelog

All notable changes to InstantNotes are recorded here. The section for each
release becomes the GitHub release notes and the "What's new" text shown by the
in-app updater, so write it for users. Newest first.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the app
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
