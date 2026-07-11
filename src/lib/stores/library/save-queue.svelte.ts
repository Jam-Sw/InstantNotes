// The library's body-save queue: debounced writes, one quiet retry, and
// flush-on-switch/blur/quit, kept as a single-writer unit apart from the rest
// of the store. It owns every "is this note persisted" decision; the store
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
import { updateNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";

/** Selected-note save status for the editor status bar. */
export type SaveState = "saved" | "saving" | "failed";

// One quiet retry this long after a failed body save; most failures (a
// competing writer briefly holding the database lock) clear well within it.
const SAVE_RETRY_MS = 2000;

export interface SaveQueueDeps {
  /** Apply a confirmed write. Called for every successful persist so the store
   *  can refresh the open note (and clear its error) when it is the one saved. */
  onPersisted: (id: string, updated: Note) => Promise<void> | void;
  /** Surface a terminal failure (after the single retry) to the store. */
  onError: (e: unknown) => void;
}

export class SaveQueue {
  // Bodies not yet confirmed persisted, by note id. An entry is only removed by
  // a successful write, so a failed save stays queued for the next flush (note
  // switch, blur, quit) instead of being silently dropped. Reassigned on change
  // so the status bar tracks it reactively.
  #unsaved = $state(new Map<string, string>());
  // Note ids whose save failed even after the retry; drives "Not saved".
  #failed = $state(new Set<string>());
  // Scheduled retry per note id, so a newer write, a drop, or a flush can
  // cancel it before it fires a stray write behind the caller's back.
  #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  #debounced = debounce((id: string, body: string) => {
    void this.#persist(id, body, true);
  }, 400);

  #deps: SaveQueueDeps;

  constructor(deps: SaveQueueDeps) {
    this.#deps = deps;
  }

  /** The queued (freshest) body for an id, or undefined; lets the opener show
   *  it instead of the disk copy, which would fork the note's history. */
  peek(id: string): string | undefined {
    return this.#unsaved.get(id);
  }

  /** Save status of one note id, for the editor status bar. */
  stateFor(id: string | undefined): SaveState {
    if (!id || !this.#unsaved.has(id)) return "saved";
    return this.#failed.has(id) ? "failed" : "saving";
  }

  /** Queue an optimistic edit; the write is debounced (400ms). */
  queue(id: string, body: string): void {
    this.#unsaved = withMapEntry(this.#unsaved, id, body);
    this.#debounced(id, body);
  }

  /** Run the pending debounced write now, e.g. before switching notes. */
  flushDebounce(): void {
    this.#debounced.flush();
  }

  /**
   * Persist every queued edit now, no retry (note switch, window blur, export,
   * quit). Cancels the debounce rather than flushing it: the retry-enabled path
   * could otherwise fire a stray write after this resolves. #unsaved already
   * holds the latest body for every note, so one no-retry write per note covers
   * the just-typed edit too.
   */
  async flushAll(): Promise<void> {
    this.#debounced.cancel();
    await Promise.all(
      [...this.#unsaved.entries()].map(([id, body]) =>
        this.#persist(id, body, false),
      ),
    );
  }

  /** Persist queued edits for specific ids now, no retry (before a soft delete,
   *  so a restored note keeps its last keystrokes). */
  async flushIds(ids: string[]): Promise<void> {
    await Promise.all(
      ids
        .filter((id) => this.#unsaved.has(id))
        .map((id) => this.#persist(id, this.#unsaved.get(id) as string, false)),
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
    for (const id of ids) this.#clearRetryTimer(id);
  }

  async #persist(id: string, body: string, canRetry: boolean): Promise<void> {
    // Any write attempt for this id, whether from the debounce, a retry, or a
    // flush, supersedes an outstanding scheduled retry for the same id.
    this.#clearRetryTimer(id);
    try {
      const updated = await updateNote(id, { body });
      // Confirmed on disk. Clear the queue entry unless a newer edit superseded
      // the body this write carried.
      if (this.#unsaved.get(id) === body) {
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
