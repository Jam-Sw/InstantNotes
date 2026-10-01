// The library's edit-save queue: debounced writes, one quiet retry, and
// flush-on-switch/blur/quit, kept as a single-writer unit apart from the rest
// of the store. A queued edit is a document's body, or a whiteboard's canvas
// with the text on it; either way the newest edit per note replaces the last. It owns every "is this note persisted" decision; the store
// composes one instance and delegates.
//
// The only outward coupling is the open note: a confirmed write updates it, and
// a terminal failure surfaces an error. Both arrive via injected callbacks so
// this class never reaches back into the store's selection or filter state.

import { debounce } from "$lib/debounce";
import {
  withMapEntry,
  withoutMapKeys,
  withSetEntry,
  withoutSetEntries,
} from "$lib/reactive-collections";
import { ApiError, getNote, updateNote } from "$lib/api/client";
import { ERROR_CODES } from "$lib/api/error-codes";
import type { Note, UpdateNotePatch } from "$lib/api/types";

/** What the queue persists for a note: `{ body }` for a document,
 *  `{ surfaceData, body }` for a whiteboard. */
export type QueuedEdit = Pick<UpdateNotePatch, "body" | "surfaceData">;

/** Selected-note save status for the editor status bar. */
export type SaveState = "saved" | "saving" | "failed";

// One quiet retry this long after a failed save; most failures (a
// competing writer briefly holding the database lock) clear well within it.
const SAVE_RETRY_MS = 2000;
// Re-reads before giving up when another process keeps writing the same note.
const CONFLICT_ATTEMPTS = 3;

export interface SaveQueueDeps {
  /** Apply a confirmed write. Called for every successful persist so the store
   *  can refresh the open note (and clear its error) when it is the one saved. */
  onPersisted: (id: string, updated: Note) => Promise<void> | void;
  /** Surface a terminal failure (after the single retry) to the store. */
  onError: (e: unknown) => void;
  /** A save replaced a body someone else (an agent) wrote after this window
   *  last saw the note. `theirs` is that body, for the user to restore. */
  onOverwrote?: (id: string, theirs: string) => void;
}

/** The last version of a note this window loaded or wrote. */
type DiskVersion = Pick<Note, "updatedAt" | "body">;

export class SaveQueue {
  // Edits not yet confirmed persisted, by note id. An entry is only removed by
  // a successful write, so a failed save stays queued for the next flush (note
  // switch, blur, quit) instead of being silently dropped. Reassigned on change
  // so the status bar tracks it reactively.
  #unsaved = $state(new Map<string, QueuedEdit>());
  // Note ids whose save failed even after the retry; drives "Not saved".
  #failed = $state(new Set<string>());
  // Scheduled retry per note id, so a newer write, a drop, or a flush can
  // cancel it before it fires a stray write behind the caller's back.
  #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per note, the version the user's edits are based on. A document save
  // carries its updatedAt, so a write from another process in between (an
  // agent) is noticed instead of silently overwritten. Not reactive: nothing
  // renders it.
  #disk = new Map<string, DiskVersion>();

  #debounced = debounce((id: string, edit: QueuedEdit) => {
    void this.#persist(id, edit, true);
  }, 400);

  #deps: SaveQueueDeps;

  constructor(deps: SaveQueueDeps) {
    this.#deps = deps;
  }

  /** The queued (freshest) edit for an id, or undefined; lets the opener show
   *  it instead of the disk copy, which would fork the note's history. */
  peek(id: string): QueuedEdit | undefined {
    return this.#unsaved.get(id);
  }

  /** Record the version of a note just loaded from disk. Only moves forward,
   *  so a slow read can never rewind past a save that already landed. */
  known(note: Pick<Note, "id" | "updatedAt" | "body">): void {
    const current = this.#disk.get(note.id);
    // Timestamps are UTC ISO-8601, so string order is time order.
    if (current && current.updatedAt >= note.updatedAt) return;
    this.#disk.set(note.id, { updatedAt: note.updatedAt, body: note.body });
  }

  /**
   * Read a note another process (an agent) just wrote, for the window to show
   * in place. Null while this window has unsaved typing for it, before or
   * after the read, or once `stillShown` says the user moved on: that typing
   * meets the other write through the version check instead (see #write).
   */
  async readExternal(id: string, stillShown: () => boolean): Promise<Note | null> {
    if (this.peek(id) !== undefined) return null;
    let fresh: Note;
    try {
      fresh = await getNote(id, false);
    } catch {
      return null;
    }
    if (!stillShown() || this.peek(id) !== undefined) return null;
    this.known(fresh);
    return fresh;
  }

  /** Save status of one note id, for the editor status bar. */
  stateFor(id: string | undefined): SaveState {
    if (!id || !this.#unsaved.has(id)) return "saved";
    return this.#failed.has(id) ? "failed" : "saving";
  }

  /** Queue an optimistic edit; the write is debounced (400ms). */
  queue(id: string, edit: QueuedEdit): void {
    this.#unsaved = withMapEntry(this.#unsaved, id, edit);
    this.#debounced(id, edit);
  }

  /** Run the pending debounced write now, e.g. before switching notes. */
  flushDebounce(): void {
    this.#debounced.flush();
  }

  /**
   * Persist every queued edit now, no retry (note switch, window blur, export,
   * quit). Cancels the debounce rather than flushing it: the retry-enabled path
   * could otherwise fire a stray write after this resolves. #unsaved already
   * holds the latest edit for every note, so one no-retry write per note covers
   * the just-typed edit too.
   */
  async flushAll(): Promise<void> {
    this.#debounced.cancel();
    await Promise.all(
      [...this.#unsaved.entries()].map(([id, edit]) =>
        this.#persist(id, edit, false),
      ),
    );
  }

  /** Persist queued edits for specific ids now, no retry (before a soft delete,
   *  so a restored note keeps its last keystrokes). */
  async flushIds(ids: string[]): Promise<void> {
    await Promise.all(
      ids
        .filter((id) => this.#unsaved.has(id))
        .map((id) => this.#persist(id, this.#unsaved.get(id) as QueuedEdit, false)),
    );
  }

  /** Cancel the debounce ahead of a delete path that will drop the ids. */
  cancelDebounce(): void {
    this.#debounced.cancel();
  }

  /** Forget queued edits for notes being discarded, so no later flush or retry
   *  writes against a row that no longer exists. */
  drop(ids: string[]): void {
    this.#unsaved = withoutMapKeys(this.#unsaved, ids);
    this.#failed = withoutSetEntries(this.#failed, ids);
    for (const id of ids) {
      this.#clearRetryTimer(id);
      this.#disk.delete(id);
    }
  }

  /**
   * Write one edit. A document edit is conditional on the version it was
   * based on; when another process wrote in between, the user's edit still
   * wins (it is what they are looking at), but only after the other body is
   * read, so the user is told and can restore it. A whiteboard canvas and a
   * note never loaded in this window are written as before.
   */
  async #write(id: string, edit: QueuedEdit): Promise<Note> {
    const base = this.#disk.get(id);
    if (!base || edit.surfaceData !== undefined) return updateNote(id, edit);
    let expected = base.updatedAt;
    let theirs: string | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        const updated = await updateNote(id, { ...edit, expectedUpdatedAt: expected });
        // A newer updatedAt with the same body is a pin, a rename, a tag:
        // nothing of theirs was replaced, so nothing to say.
        if (theirs !== null && theirs !== base.body) this.#deps.onOverwrote?.(id, theirs);
        return updated;
      } catch (e) {
        const conflict = e instanceof ApiError && e.code === ERROR_CODES.CONFLICT;
        if (!conflict || attempt >= CONFLICT_ATTEMPTS) throw e;
        const disk = await getNote(id, false);
        expected = disk.updatedAt;
        theirs = disk.body;
      }
    }
  }

  async #persist(id: string, edit: QueuedEdit, canRetry: boolean): Promise<void> {
    // Any write attempt for this id, whether from the debounce, a retry, or a
    // flush, supersedes an outstanding scheduled retry for the same id.
    this.#clearRetryTimer(id);
    try {
      const updated = await this.#write(id, edit);
      this.known(updated);
      // Confirmed on disk. Clear the queue entry unless a newer edit superseded
      // the one this write carried.
      if (this.#unsaved.get(id) === edit) {
        this.#unsaved = withoutMapKeys(this.#unsaved, [id]);
      }
      if (this.#failed.has(id)) {
        this.#failed = withoutSetEntries(this.#failed, [id]);
      }
      await this.#deps.onPersisted(id, updated);
    } catch (e) {
      if (canRetry) {
        const timer = setTimeout(() => {
          this.#retryTimers.delete(id);
          const latest = this.#unsaved.get(id);
          if (latest !== undefined) void this.#persist(id, latest, false);
        }, SAVE_RETRY_MS);
        this.#retryTimers.set(id, timer);
      } else {
        this.#failed = withSetEntry(this.#failed, id);
        this.#deps.onError(e);
      }
    }
  }

  #clearRetryTimer(id: string): void {
    const timer = this.#retryTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#retryTimers.delete(id);
    }
  }
}
