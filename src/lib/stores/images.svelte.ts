import { getSetting, setSetting } from "$lib/api/client";
import { EVENTS, listen } from "$lib/api/events";

export type ImageStorage = "copy" | "link";

const KEY_STORAGE = "images.storage";
const KEY_MAX_HEIGHT = "images.maxPreviewHeight";
const KEY_LINKED_FOLDERS = "images.linkedFolders";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 900;
export const DEFAULT_MAX_HEIGHT = 420;

class ImagePrefs {
  storage = $state<ImageStorage>("copy");
  maxPreviewHeight = $state(DEFAULT_MAX_HEIGHT);
  linkedFolders = $state<string[]>([]);

  #loaded = false;
  #listening = false;

  async init(): Promise<void> {
    if (!this.#listening) {
      this.#listening = true;
      void listen(EVENTS.SETTINGS_CHANGED, () => void this.reload()).catch(() => {});
    }
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [storage, height, folders] = await Promise.all([
        getSetting<string>(KEY_STORAGE),
        getSetting<number>(KEY_MAX_HEIGHT),
        getSetting<string[]>(KEY_LINKED_FOLDERS),
      ]);
      if (storage === "copy" || storage === "link") this.storage = storage;
      if (typeof height === "number") this.maxPreviewHeight = this.#clampHeight(height);
      if (Array.isArray(folders) && folders.every((f) => typeof f === "string")) this.linkedFolders = folders;
    } catch {
    }
  }

  async reload(): Promise<void> {
    this.#loaded = false;
    await this.init();
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

  removeLinkedFolder(path: string): void {
    this.linkedFolders = this.linkedFolders.filter((f) => f !== path);
    void setSetting(KEY_LINKED_FOLDERS, this.linkedFolders);
  }
}

export const imagePrefs = new ImagePrefs();
export const IMAGE_HEIGHT_RANGE = { min: MIN_HEIGHT, max: MAX_HEIGHT };
