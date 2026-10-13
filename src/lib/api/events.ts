import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWeb } from "./runtime";

let stream: EventSource | null = null;
let lastProbe = 0;

function probeSession(): void {
  const now = Date.now();
  if (now - lastProbe < 10_000) return;
  lastProbe = now;
  void fetch("/api/app_version", { method: "POST", headers: { "X-InstantNotes": "1" } }).then(
    (res) => {
      if (res.status === 401) location.assign("/auth/login");
    },
    () => {},
  );
}

function webStream(): EventSource {
  if (!stream) {
    stream = new EventSource("/api/events");
    stream.onerror = probeSession;
  }
  return stream;
}

export async function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isWeb) return tauriListen<T>(event, handler);
  const source = webStream();
  const on = (m: MessageEvent) => {
    let payload: T = null as T;
    try {
      payload = m.data ? (JSON.parse(m.data) as T) : (null as T);
    } catch {
    }
    handler({ payload });
  };
  source.addEventListener(event, on);
  return () => source.removeEventListener(event, on);
}

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
  VAULT_SYNCED: "vault:synced",
  APP_QUIT_REQUESTED: "app:quit-requested",
  CAPTURE_SHOWN: "capture:shown",
  MENU_TOGGLE_STICKY: "menu:toggle-sticky",
  STICKIES_CHANGED: "stickies:changed",
  STICKY_CLOSE_REQUESTED: "sticky:close-requested",
  LIBRARY_EXTERNAL_CHANGE: "library:external-change",
  AGENT_SESSIONS: "agents:sessions",
  SYNC_JOIN_REQUESTS: "sync:join-requests",
} as const;

export const LIBRARY_CHANGED_EVENTS = [
  EVENTS.NOTES_CHANGED,
  EVENTS.TAGS_CHANGED,
  EVENTS.WORKSPACES_CHANGED,
] as const;
