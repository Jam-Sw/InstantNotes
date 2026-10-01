// Editor preferences (Svelte 5 runes): the text zoom level and whether the
// format toolbar is open. Persisted to the existing settings KV so they survive
// restarts, mirroring the theme store.

import { getSetting, setSetting } from "$lib/api/client";

const KEY_ZOOM = "editor.zoom";
const KEY_TOOLBAR = "editor.toolbarOpen";
const KEY_EXACT_TIME = "editor.showExactTime";
const MIN = 0.7;
const MAX = 2.5;
const STEP = 0.1;

class EditorPrefs {
  zoom = $state(1);
  toolbarOpen = $state(false);
  // Show the full minute-precise save time inline in the editor status bar.
  // The exact time is always available on hover regardless of this toggle.
  showExactTime = $state(false);

  #loaded = false;
  // A setter called while init()'s read is still in flight must win: without
  // this, the read resolving afterward would silently overwrite the user's
  // change back to the old persisted value.
  #touched = new Set<string>();

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [z, open, exact] = await Promise.all([
        getSetting<number>(KEY_ZOOM),
        getSetting<boolean>(KEY_TOOLBAR),
        getSetting<boolean>(KEY_EXACT_TIME),
      ]);
      if (!this.#touched.has(KEY_ZOOM) && typeof z === "number" && z >= MIN && z <= MAX) {
        this.zoom = z;
      }
      if (!this.#touched.has(KEY_TOOLBAR) && typeof open === "boolean") {
        this.toolbarOpen = open;
      }
      if (!this.#touched.has(KEY_EXACT_TIME) && typeof exact === "boolean") {
        this.showExactTime = exact;
      }
    } catch {
      // Settings are best-effort; fall back to defaults silently.
    }
  }

  setShowExactTime(v: boolean): void {
    this.#touched.add(KEY_EXACT_TIME);
    this.showExactTime = v;
    void setSetting(KEY_EXACT_TIME, v);
  }

  #clamp(z: number): number {
    return Math.min(MAX, Math.max(MIN, +z.toFixed(1)));
  }

  setZoom(z: number): void {
    this.#touched.add(KEY_ZOOM);
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
    this.#touched.add(KEY_TOOLBAR);
    this.toolbarOpen = !this.toolbarOpen;
    void setSetting(KEY_TOOLBAR, this.toolbarOpen);
  }
}

export const editorPrefs = new EditorPrefs();
