//! Every event name the shell emits, in one place.
//!
//! An event name is a contract with the webview that no type can reach across:
//! the frontend mirror is `src/lib/api/events.ts`, and
//! `src/lib/api/contract.test.ts` holds the two lists equal, so renaming one
//! side alone fails a test instead of silently dropping a listener.

/// Notes were added, changed, or removed; the frontend re-queries.
pub const NOTES_CHANGED: &str = "notes:changed";
/// Tags changed.
pub const TAGS_CHANGED: &str = "tags:changed";
/// Spaces changed (storage and IPC say "workspace"; see openspec/project.md).
pub const WORKSPACES_CHANGED: &str = "workspaces:changed";
/// Open the Settings window (app menu).
pub const SETTINGS_OPEN: &str = "settings:open";
/// File menu: new note, new whiteboard, new sheet, export the open note.
pub const MENU_NEW_NOTE: &str = "menu:new-note";
pub const MENU_NEW_WHITEBOARD: &str = "menu:new-whiteboard";
pub const MENU_NEW_SHEET: &str = "menu:new-sheet";
pub const MENU_EXPORT_NOTE: &str = "menu:export-note";
/// Check for an update now (app menu).
pub const UPDATER_CHECK: &str = "updater:check";
/// Global-shortcut registration failed; payload is the shortcut label.
pub const SHORTCUT_FAILED: &str = "shortcut:failed";
/// A vault mirror flush finished; re-read `get_vault_status`.
pub const VAULT_STATUS: &str = "vault:status";
/// The user asked to quit; windows save before the app exits.
pub const APP_QUIT_REQUESTED: &str = "app:quit-requested";
/// The capture panel became visible (emitted to that window only).
pub const CAPTURE_SHOWN: &str = "capture:shown";
/// File menu: pop the open note out as a sticky, or back in.
pub const MENU_TOGGLE_STICKY: &str = "menu:toggle-sticky";
/// A note became a sticky or stopped being one; re-read `list_stickies`.
pub const STICKIES_CHANGED: &str = "stickies:changed";
/// Pop in: the sticky flushes, then answers `answer_pop_in` (that window only).
pub const STICKY_CLOSE_REQUESTED: &str = "sticky:close-requested";
/// Another process wrote to the library (an agent, via `instantnotes mcp`);
/// payload is the new agent activity entries, oldest first. See
/// `shell/agents.rs`.
pub const LIBRARY_EXTERNAL_CHANGE: &str = "library:external-change";
/// Which agents are connected changed; the payload is every known
/// connection, newest first. See `shell/agents.rs`.
pub const AGENT_SESSIONS: &str = "agents:sessions";
