// Contexting (Svelte 5 runes): the user-editable template for copying a note as
// LLM-ready context. Persisted to the existing settings KV like the editor and
// theme stores. Rendering logic lives in the pure contexting-format module.

import { getSetting, setSetting } from "$lib/api/client";
import type { Note, Tag } from "$lib/api/types";
import { DEFAULT_TEMPLATE, renderTemplate } from "$lib/contexting-format";

const KEY_TEMPLATE = "contexting.copyTemplate";

class ContextingStore {
  copyTemplate = $state(DEFAULT_TEMPLATE);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const t = await getSetting<string>(KEY_TEMPLATE);
      if (typeof t === "string" && t.length > 0) this.copyTemplate = t;
    } catch {
      // Settings are best-effort; keep the default template silently.
    }
  }

  setTemplate(t: string): void {
    this.copyTemplate = t;
    void setSetting(KEY_TEMPLATE, t);
  }

  /** Render the active template for a note and its tags, ready for the clipboard. */
  render(note: Note, tags: Tag[]): string {
    return renderTemplate(this.copyTemplate, note, tags);
  }
}

export const contexting = new ContextingStore();
