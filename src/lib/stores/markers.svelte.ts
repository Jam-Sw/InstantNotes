import { emit } from "@tauri-apps/api/event";
import { getSetting, setSetting } from "$lib/api/client";
import { EVENTS, listen } from "$lib/api/events";
import { isWeb } from "$lib/api/runtime";
import { MARKER_MODE_DEFAULT, MARKER_MODE_KEY, parseMarkerMode, type MarkerMode } from "$lib/space-colors";

class MarkerPrefs {
  mode = $state<MarkerMode>(MARKER_MODE_DEFAULT);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await this.reload();
    void listen(EVENTS.SETTINGS_CHANGED, () => void this.reload()).catch(() => {});
  }

  async reload(): Promise<void> {
    try {
      this.mode = parseMarkerMode(await getSetting<unknown>(MARKER_MODE_KEY));
    } catch {
    }
  }

  async setMode(mode: MarkerMode): Promise<void> {
    this.mode = mode;
    await setSetting(MARKER_MODE_KEY, mode);
    if (!isWeb) void emit(EVENTS.SETTINGS_CHANGED).catch(() => {});
  }
}

export const markerPrefs = new MarkerPrefs();
