// One sticky window's note (Svelte 5 runes). While a note is a sticky this is
// its only editor in the app: the library shows a placeholder instead, so the
// save queue here is the note's single in-app writer, the same SaveQueue the
// library composes.
//
// Only metadata follows change events (title, pin, trash). The body follows
// an agent's write the way the library's open note does (`adoptExternal`),
// never a plain change event: re-reading it then would race this window's own
// unsaved typing.

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

export class StickyNote {
  note = $state<Note | null>(null);
  /** The note was destroyed or moved to the Trash behind this window. */
  gone = $state(false);
  error = $state<string | null>(null);

  #queue = new SaveQueue({
    onPersisted: (id, updated) => {
      if (this.note?.id !== id) return;
      // Keep the local body and canvas: typing may have continued past this
      // save, and the reply never carries the canvas.
      const { body, surfaceData } = this.note;
      this.note = { ...updated, body, surfaceData };
      this.error = null;
    },
    onError: (e) => this.#fail(e, SAVE_CONFLICT_MESSAGE),
    onOverwrote: (id, theirs) =>
      announceOverwrite(id, () => {
        if (this.note?.id === id) this.editBody(theirs);
      }),
  });

  // A whiteboard batches canvas changes before handing them over; it
  // registers here and is asked for them before every flush.
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

  /** Persist everything now. True when nothing is left unsaved, which is
   *  the only answer that lets the window close. */
  async flush(): Promise<boolean> {
    for (const hook of this.#beforeFlush) hook();
    await this.#queue.flushAll();
    return this.saveState === "saved";
  }

  /** Follow a change event: take new metadata, keep this window's body. A
   *  note that went to the Trash or was destroyed marks the sticky gone, and
   *  its queued edits are dropped since there is no live row to write. */
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

  /** An agent wrote. With nothing unsaved here, the sticky takes the new
   *  version and the editor applies it under the caret; with unsaved typing
   *  it is left alone, and that save meets the agent's write through the
   *  version check, which offers the agent's text back. */
  async adoptExternal(entries: AgentActivity[]): Promise<void> {
    const open = this.note;
    if (!open || this.gone || open.contentKind === "whiteboard") return;
    if (!mayHaveWritten(entries, open.id)) return;
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
