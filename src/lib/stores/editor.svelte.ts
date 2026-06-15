// Editor preferences (Svelte 5 runes): the text zoom level and whether the
// format toolbar is open. Persisted to the existing settings KV so they survive
// restarts, mirroring the theme store.

import { getSetting, setSetting } from "$lib/api/client";

const KEY_ZOOM = "editor.zoom";
const KEY_TOOLBAR = "editor.toolbarOpen";
const MIN = 0.7;
const MAX = 2.5;
const STEP = 0.1;

class EditorPrefs {
  zoom = $state(1);
  toolbarOpen = $state(false);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [z, open] = await Promise.all([
        getSetting<number>(KEY_ZOOM),
        getSetting<boolean>(KEY_TOOLBAR),
      ]);
      if (typeof z === "number" && z >= MIN && z <= MAX) this.zoom = z;
      if (typeof open === "boolean") this.toolbarOpen = open;
    } catch {
      // Settings are best-effort; fall back to defaults silently.
    }
  }

  #clamp(z: number): number {
    return Math.min(MAX, Math.max(MIN, +z.toFixed(1)));
  }

  setZoom(z: number): void {
    this.zoom = this.#clamp(z);
    void setSetting(KEY_ZOOM, this.zoom);
  }

  zoomIn(): void {
    this.setZoom(this.zoom + STEP);
  }

  zoomOut(): void {
    this.setZoom(this.zoom - STEP);
  }

  resetZoom(): void {
    this.setZoom(1);
  }

  toggleToolbar(): void {
    this.toolbarOpen = !this.toolbarOpen;
    void setSetting(KEY_TOOLBAR, this.toolbarOpen);
  }
}

export const editorPrefs = new EditorPrefs();
