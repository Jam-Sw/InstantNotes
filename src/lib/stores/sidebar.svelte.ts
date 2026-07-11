// Sidebar layout state (Svelte 5 runes): drag-resizable width and an
// open/closed toggle. Persisted to the settings KV like editorPrefs, so the
// layout comes back the way it was left.

import { getSetting, setSetting } from "$lib/api/client";

const KEY_WIDTH = "sidebar.width";
const KEY_COLLAPSED = "sidebar.collapsed";

export const SIDEBAR_MIN = 150;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 190;

class SidebarState {
  width = $state(SIDEBAR_DEFAULT);
  collapsed = $state(false);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [w, c] = await Promise.all([
        getSetting<number>(KEY_WIDTH),
        getSetting<boolean>(KEY_COLLAPSED),
      ]);
      if (typeof w === "number" && w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) this.width = w;
      if (typeof c === "boolean") this.collapsed = c;
    } catch {
      // Settings are best-effort; fall back to defaults silently.
    }
  }

  #clamp(w: number): number {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
  }

  /** Live-updates during a drag; call commitWidth() once when it ends. */
  setWidth(w: number): void {
    this.width = this.#clamp(w);
  }

  /** Persist the width once per gesture instead of on every pointermove. */
  commitWidth(): void {
    void setSetting(KEY_WIDTH, this.width);
  }

  resetWidth(): void {
    this.width = SIDEBAR_DEFAULT;
    this.commitWidth();
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    void setSetting(KEY_COLLAPSED, this.collapsed);
  }
}

export const sidebar = new SidebarState();
