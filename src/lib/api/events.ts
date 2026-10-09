export const EVENTS = {
  NOTES_CHANGED: "notes:changed",
  TAGS_CHANGED: "tags:changed",
  WORKSPACES_CHANGED: "workspaces:changed",
  SETTINGS_OPEN: "settings:open",
  MENU_NEW_NOTE: "menu:new-note",
  MENU_NEW_WHITEBOARD: "menu:new-whiteboard",
  MENU_NEW_SHEET: "menu:new-sheet",
  MENU_EXPORT_NOTE: "menu:export-note",
  UPDATER_CHECK: "updater:check",
  SHORTCUT_FAILED: "shortcut:failed",
  VAULT_STATUS: "vault:status",
  APP_QUIT_REQUESTED: "app:quit-requested",
  CAPTURE_SHOWN: "capture:shown",
  MENU_TOGGLE_STICKY: "menu:toggle-sticky",
  STICKIES_CHANGED: "stickies:changed",
  STICKY_CLOSE_REQUESTED: "sticky:close-requested",
  LIBRARY_EXTERNAL_CHANGE: "library:external-change",
  AGENT_SESSIONS: "agents:sessions",
} as const;

export const LIBRARY_CHANGED_EVENTS = [
  EVENTS.NOTES_CHANGED,
  EVENTS.TAGS_CHANGED,
  EVENTS.WORKSPACES_CHANGED,
] as const;
