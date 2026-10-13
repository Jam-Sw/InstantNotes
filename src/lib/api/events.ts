import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWeb } from "./runtime";
import { on } from "$lib/web/core";

export async function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isWeb) return tauriListen<T>(event, handler);
  return on(event, (payload) => handler({ payload: payload as T }));
}

export const EVENTS = {
  NOTES_CHANGED: "notes:changed",
  TAGS_CHANGED: "tags:changed",
  WORKSPACES_CHANGED: "workspaces:changed",
  MENU_COMMAND: "menu:command",
  SHORTCUT_FAILED: "shortcut:failed",
  VAULT_STATUS: "vault:status",
  VAULT_SYNCED: "vault:synced",
  APP_QUIT_REQUESTED: "app:quit-requested",
  CAPTURE_SHOWN: "capture:shown",
  STICKIES_CHANGED: "stickies:changed",
  STICKY_CLOSE_REQUESTED: "sticky:close-requested",
  LIBRARY_EXTERNAL_CHANGE: "library:external-change",
  AGENT_SESSIONS: "agents:sessions",
  SYNC_JOIN_REQUESTS: "sync:join-requests",
  BACKUPS_CHANGED: "backups:changed",
  SETTINGS_CHANGED: "settings:changed",
} as const;

export const LIBRARY_CHANGED_EVENTS = [
  EVENTS.NOTES_CHANGED,
  EVENTS.TAGS_CHANGED,
  EVENTS.WORKSPACES_CHANGED,
] as const;
