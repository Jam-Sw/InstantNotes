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
  showExactTime = $state(false);

  #loaded = false;
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
