// The frontend's one definition of the event names the backend emits. The
// Rust mirror is src-tauri/src/events.rs; `contract.test.ts` holds the two
// lists equal, so renaming one side alone fails a test instead of silently
// dropping a listener.

export const EVENTS = {
  NOTES_CHANGED: "notes:changed",
  TAGS_CHANGED: "tags:changed",
  WORKSPACES_CHANGED: "workspaces:changed",
  SETTINGS_OPEN: "settings:open",
  MENU_NEW_NOTE: "menu:new-note",
  MENU_NEW_WHITEBOARD: "menu:new-whiteboard",
  MENU_EXPORT_NOTE: "menu:export-note",
  UPDATER_CHECK: "updater:check",
  SHORTCUT_FAILED: "shortcut:failed",
  VAULT_STATUS: "vault:status",
  APP_QUIT_REQUESTED: "app:quit-requested",
  CAPTURE_SHOWN: "capture:shown",
} as const;

export type AppEvent = (typeof EVENTS)[keyof typeof EVENTS];

/** The three events that mean "the library changed, re-query it". Anything
 *  drawing the whole library (the store, the graph) listens to all three. */
export const LIBRARY_CHANGED_EVENTS = [
  EVENTS.NOTES_CHANGED,
  EVENTS.TAGS_CHANGED,
  EVENTS.WORKSPACES_CHANGED,
] as const;
