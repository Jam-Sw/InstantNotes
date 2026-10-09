import { ApiError, getNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";
import { ERROR_CODES } from "$lib/api/error-codes";
import { friendlyError, SAVE_CONFLICT_MESSAGE } from "$lib/errors";
import { mayHaveWritten, type AgentActivity } from "$lib/agent-activity";
import { announceOverwrite } from "$lib/stores/agents.svelte";
import {
  SaveQueue,
  type QueuedEdit,
  type SaveState,
} from "$lib/stores/library/save-queue.svelte";
import { appendRows, parseSheet, serializeSheet } from "$lib/sheet/model";

export class StickyNote {
  note = $state<Note | null>(null);
  gone = $state(false);
  error = $state<string | null>(null);

  #queue = new SaveQueue({
    onPersisted: (id, updated) => {
      if (this.note?.id !== id) return;
      const { body, surfaceData, contentKind } = this.note;
      this.note = {
        ...updated,
        body: contentKind === "sheet" ? updated.body : body,
        surfaceData,
      };
      this.error = null;
    },
    onError: (e) => this.#fail(e, SAVE_CONFLICT_MESSAGE),
    onOverwrote: (id, theirs) =>
      announceOverwrite(id, () => {
        if (this.note?.id === id) this.editBody(theirs);
      }),
    onMerged: (id, added) => {
      if (this.note?.id !== id || added.length === 0) return;
      const surfaceData = serializeSheet(appendRows(parseSheet(this.note.surfaceData), added));
      this.note.surfaceData = surfaceData;
      if (this.#queue.peek(id) !== undefined) this.#queue.queue(id, { surfaceData });
    },
  });

  #beforeFlush = new Set<() => void>();

  get saveState(): SaveState {
    return this.#queue.stateFor(this.note?.id);
  }

  onBeforeFlush(hook: () => void): () => void {
    this.#beforeFlush.add(hook);
    return () => this.#beforeFlush.delete(hook);
  }

  async load(id: string): Promise<void> {
    try {
      this.note = await getNote(id, true);
      this.#queue.known(this.note);
      this.gone = this.note.isDeleted;
      this.error = null;
    } catch (e) {
      this.#fail(e);
      if (e instanceof ApiError && e.code === ERROR_CODES.NOT_FOUND) this.gone = true;
    }
  }

  editBody(body: string): void {
    if (!this.note || this.gone) return;
    this.note.body = body;
    this.#queue.queue(this.note.id, { body });
  }

  editBoard(id: string, edit: Required<QueuedEdit>): void {
    if (this.note?.id !== id || this.gone) return;
    this.note.surfaceData = edit.surfaceData;
    this.note.body = edit.body;
    this.#queue.queue(id, edit);
  }

  editSheet(id: string, surfaceData: string): void {
    if (this.note?.id !== id || this.gone) return;
    this.note.surfaceData = surfaceData;
    this.#queue.queue(id, { surfaceData });
  }

  async flush(): Promise<boolean> {
    for (const hook of this.#beforeFlush) hook();
    await this.#queue.flushAll();
    return this.saveState === "saved";
  }

  async refreshMeta(): Promise<void> {
    const current = this.note;
    if (!current || this.gone) return;
    try {
      const fresh = await getNote(current.id, false);
      if (this.note?.id !== current.id) return;
      const { body, surfaceData } = this.note;
      this.note = { ...fresh, body, surfaceData };
      if (fresh.isDeleted) this.#markGone();
    } catch (e) {
      if (e instanceof ApiError && e.code === ERROR_CODES.NOT_FOUND) this.#markGone();
    }
  }

  async adoptExternal(entries: AgentActivity[]): Promise<void> {
    const open = this.note;
    if (!open || this.gone || open.contentKind === "whiteboard") return;
    if (!mayHaveWritten(entries, open.id)) return;
    if (open.contentKind === "sheet") {
      const taken = await this.#queue.readExternalSheet(
        open.id,
        () => this.note?.id === open.id && !this.gone,
      );
      if (taken && this.note?.id === open.id) {
        this.note = { ...taken.note, surfaceData: taken.surfaceData };
      }
      return;
    }
    const shown = open.body;
    const fresh = await this.#queue.readExternal(
      open.id,
      () => this.note?.id === open.id && this.note.body === shown && !this.gone,
    );
    if (!fresh || !this.note) return;
    this.note = { ...fresh, surfaceData: this.note.surfaceData };
  }

  #markGone(): void {
    this.gone = true;
    if (this.note) this.#queue.drop([this.note.id]);
  }

  #fail(e: unknown, conflict?: string): void {
    this.error = friendlyError(e, conflict);
  }
}
