// Image preferences (Svelte 5 runes): how images are stored when added to a
// note, and how large they render inline. Persisted to the settings KV like the
// other preference stores.
//
// Storage mode governs INSERTION only (paste, drop, and "Insert image..."):
// - "copy": image bytes are copied into the app's attachments folder, so
//   exported markdown stays portable. Pasted screenshots are always copied,
//   since there is no original file to link.
// - "link": a file picked from disk is referenced in place by its absolute
//   path (rendered through the asset protocol). Saves disk but breaks if the
//   original file moves or is deleted.

import { getSetting, setSetting } from "$lib/api/client";

export type ImageStorage = "copy" | "link";

const KEY_STORAGE = "images.storage";
const KEY_MAX_HEIGHT = "images.maxPreviewHeight";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 900;
export const DEFAULT_MAX_HEIGHT = 420;

class ImagePrefs {
  storage = $state<ImageStorage>("copy");
  maxPreviewHeight = $state(DEFAULT_MAX_HEIGHT);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [storage, height] = await Promise.all([
        getSetting<string>(KEY_STORAGE),
        getSetting<number>(KEY_MAX_HEIGHT),
      ]);
      if (storage === "copy" || storage === "link") this.storage = storage;
      if (typeof height === "number") this.maxPreviewHeight = this.#clampHeight(height);
    } catch {
      // Settings are best-effort; fall back to defaults silently.
    }
  }

  #clampHeight(h: number): number {
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));
  }

  setStorage(v: ImageStorage): void {
    this.storage = v;
    void setSetting(KEY_STORAGE, v);
  }

  setMaxPreviewHeight(h: number): void {
    this.maxPreviewHeight = this.#clampHeight(h);
    void setSetting(KEY_MAX_HEIGHT, this.maxPreviewHeight);
  }
}

export const imagePrefs = new ImagePrefs();
export const IMAGE_HEIGHT_RANGE = { min: MIN_HEIGHT, max: MAX_HEIGHT };
