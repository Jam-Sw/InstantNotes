import { getSetting, setSetting, getAttachmentsDir } from "$lib/api/client";
import type { Note, Tag } from "$lib/api/types";
import {
  DEFAULT_TEMPLATE,
  DEFAULT_IMAGE_MODE,
  renderTemplate,
  type ContextImageMode,
} from "$lib/contexting-format";

const KEY_TEMPLATE = "contexting.copyTemplate";
const KEY_IMAGE_MODE = "contexting.imageMode";

class ContextingStore {
  copyTemplate = $state(DEFAULT_TEMPLATE);
  imageMode = $state<ContextImageMode>(DEFAULT_IMAGE_MODE);
  attachmentsDir = $state<string | null>(null);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [t, mode, dir] = await Promise.all([
        getSetting<string>(KEY_TEMPLATE),
        getSetting<string>(KEY_IMAGE_MODE),
        getAttachmentsDir().catch(() => null),
      ]);
      if (typeof t === "string" && t.length > 0) this.copyTemplate = t;
      if (mode === "keep" || mode === "absolute" || mode === "strip") this.imageMode = mode;
      if (typeof dir === "string") this.attachmentsDir = dir;
    } catch {
    }
  }

  setTemplate(t: string): void {
    this.copyTemplate = t;
    void setSetting(KEY_TEMPLATE, t);
  }

  setImageMode(mode: ContextImageMode): void {
    this.imageMode = mode;
    void setSetting(KEY_IMAGE_MODE, mode);
  }

  render(note: Note, tags: Tag[]): string {
    return renderTemplate(this.copyTemplate, note, tags, {
      imageMode: this.imageMode,
      attachmentsDir: this.attachmentsDir,
    });
  }
}

export const contexting = new ContextingStore();
