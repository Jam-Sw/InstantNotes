import { getSetting, setSetting } from "$lib/api/client";
import { MARKER_MODE_DEFAULT, MARKER_MODE_KEY, parseMarkerMode, type MarkerMode } from "$lib/space-colors";

class MarkerPrefs {
  mode = $state<MarkerMode>(MARKER_MODE_DEFAULT);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      this.mode = parseMarkerMode(await getSetting<unknown>(MARKER_MODE_KEY));
    } catch {
    }
  }

  setMode(mode: MarkerMode): void {
    this.mode = mode;
    void setSetting(MARKER_MODE_KEY, mode);
  }
}

export const markerPrefs = new MarkerPrefs();
