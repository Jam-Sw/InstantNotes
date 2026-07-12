// Contexting (Svelte 5 runes): the user-editable template for copying a note as
// LLM-ready context, plus how images in the note travel. Persisted to the
// existing settings KV like the editor and theme stores. Rendering logic lives
// in the pure contexting-format module.

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
  // Absolute attachments directory, needed to rewrite attachment images to
  // their real path in "absolute" mode. Fetched once and cached.
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
      // Settings are best-effort; keep the defaults silently.
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

  /** Render the active template for a note and its tags, ready for the clipboard. */
  render(note: Note, tags: Tag[]): string {
    return renderTemplate(this.copyTemplate, note, tags, {
      imageMode: this.imageMode,
      attachmentsDir: this.attachmentsDir,
    });
  }
}

export const contexting = new ContextingStore();
