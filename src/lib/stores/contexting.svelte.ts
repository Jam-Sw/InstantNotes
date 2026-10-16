import { getSetting, setSetting, getAttachmentsDir, getNote, tagsForNote } from "$lib/api/client";
import type { Note, Tag } from "$lib/api/types";
import {
  DEFAULT_TEMPLATE,
  DEFAULT_IMAGE_MODE,
  DEFAULT_SOURCE_LINE,
  joinContexts,
  renderContext,
  type ContextImageMode,
} from "$lib/contexting-format";

const KEY_TEMPLATE = "contexting.copyTemplate";
const KEY_IMAGE_MODE = "contexting.imageMode";
const KEY_SOURCE_LINE = "contexting.sourceLine";

class ContextingStore {
  copyTemplate = $state(DEFAULT_TEMPLATE);
  imageMode = $state<ContextImageMode>(DEFAULT_IMAGE_MODE);
  addSourceLine = $state(DEFAULT_SOURCE_LINE);
  attachmentsDir = $state<string | null>(null);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [t, mode, source, dir] = await Promise.all([
        getSetting<string>(KEY_TEMPLATE),
        getSetting<string>(KEY_IMAGE_MODE),
        getSetting<boolean>(KEY_SOURCE_LINE),
        getAttachmentsDir().catch(() => null),
      ]);
      if (typeof t === "string" && t.length > 0) this.copyTemplate = t;
      if (mode === "keep" || mode === "absolute" || mode === "strip") this.imageMode = mode;
      if (typeof source === "boolean") this.addSourceLine = source;
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

  setAddSourceLine(on: boolean): void {
    this.addSourceLine = on;
    void setSetting(KEY_SOURCE_LINE, on);
  }

  render(note: Note, tags: Tag[], copiedAt: Date = new Date()): string {
    return renderContext(this.copyTemplate, note, tags, {
      imageMode: this.imageMode,
      attachmentsDir: this.attachmentsDir,
      addSourceLine: this.addSourceLine,
      copiedAt,
    });
  }

  /** Full notes (the list holds trimmed bodies), rendered in the order given and joined. */
  async renderIds(ids: string[]): Promise<string> {
    await this.init();
    const copiedAt = new Date();
    const blocks = await Promise.all(
      ids.map(async (id) => {
        const [note, tags] = await Promise.all([getNote(id), tagsForNote(id)]);
        return this.render(note, tags, copiedAt);
      }),
    );
    return joinContexts(blocks);
  }

  async copyIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await navigator.clipboard.writeText(await this.renderIds(ids));
  }
}

export const contexting = new ContextingStore();
