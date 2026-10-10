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
import { mergeAppended, parseSheet, serializeSheet } from "$lib/sheet/model";

export type QueuedEdit = Pick<UpdateNotePatch, "body" | "surfaceData">;

export type SaveState = "saved" | "saving" | "failed";

const SAVE_RETRY_MS = 2000;
const CONFLICT_ATTEMPTS = 3;

export interface SaveQueueDeps {
  onPersisted: (id: string, updated: Note) => Promise<void> | void;
  onError: (e: unknown) => void;
  onOverwrote?: (id: string, theirs: string) => void;
  onMerged?: (id: string, added: string[][]) => void;
}

type DiskVersion = Pick<Note, "updatedAt" | "body" | "contentKind"> & {
  surfaceData?: string | null;
};

type Seen = Pick<Note, "id" | "updatedAt" | "body" | "contentKind"> & {
  surfaceData?: string | null;
};

export class SaveQueue {
  #unsaved = $state(new Map<string, QueuedEdit>());
  #failed = $state(new Set<string>());
  #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #disk = new Map<string, DiskVersion>();

  #debounced = debounce((id: string, edit: QueuedEdit) => {
    void this.#persist(id, edit, true);
  }, 400);

  #deps: SaveQueueDeps;

  constructor(deps: SaveQueueDeps) {
    this.#deps = deps;
  }

  peek(id: string): QueuedEdit | undefined {
    return this.#unsaved.get(id);
  }

  known(note: Seen): void {
    const current = this.#disk.get(note.id);
    if (current && current.updatedAt >= note.updatedAt) return;
    this.#disk.set(note.id, {
      updatedAt: note.updatedAt,
      body: note.body,
      contentKind: note.contentKind,
      surfaceData: note.surfaceData ?? current?.surfaceData,
    });
  }

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

  async readExternalSheet(
    id: string,
    stillShown: () => boolean,
  ): Promise<{ note: Note; surfaceData: string } | null> {
    let fresh: Note;
    try {
      fresh = await getNote(id, false);
    } catch {
      return null;
    }
    if (!stillShown() || !fresh.surfaceData) return null;
    const pending = this.peek(id);
    const base = this.#disk.get(id);
    this.known(fresh);
    if (pending?.surfaceData === undefined) return { note: fresh, surfaceData: fresh.surfaceData };
    const { sheet, added } = mergeAppended(
      parseSheet(base?.surfaceData),
      parseSheet(pending.surfaceData),
      parseSheet(fresh.surfaceData),
    );
    if (added.length === 0) return null;
    const surfaceData = serializeSheet(sheet);
    this.queue(id, { surfaceData });
    return { note: fresh, surfaceData };
  }

  stateFor(id: string | undefined): SaveState {
    if (!id || !this.#unsaved.has(id)) return "saved";
    return this.#failed.has(id) ? "failed" : "saving";
  }

  queue(id: string, edit: QueuedEdit): void {
    this.#unsaved = withMapEntry(this.#unsaved, id, edit);
    this.#debounced(id, edit);
  }

  flushDebounce(): void {
    this.#debounced.flush();
  }

  async flushAll(): Promise<void> {
    this.#debounced.cancel();
    await Promise.all(
      [...this.#unsaved.entries()].map(([id, edit]) =>
        this.#persist(id, edit, false),
      ),
    );
  }

  async flushIds(ids: string[]): Promise<void> {
    await Promise.all(
      ids
        .filter((id) => this.#unsaved.has(id))
        .map((id) => this.#persist(id, this.#unsaved.get(id) as QueuedEdit, false)),
    );
  }

  cancelDebounce(): void {
    this.#debounced.cancel();
  }

  drop(ids: string[]): void {
    this.#unsaved = withoutMapKeys(this.#unsaved, ids);
    this.#failed = withoutSetEntries(this.#failed, ids);
    for (const id of ids) {
      this.#clearRetryTimer(id);
      this.#disk.delete(id);
    }
  }

  async #write(id: string, edit: QueuedEdit): Promise<{ updated: Note; merged?: string[][] }> {
    const base = this.#disk.get(id);
    if (!base || base.contentKind === "whiteboard") return { updated: await updateNote(id, edit) };
    let expected = base.updatedAt;
    let theirs: Note | null = null;
    let carrying = edit;
    let merged: string[][] | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        const updated = await updateNote(id, { ...carrying, expectedUpdatedAt: expected });
        if (theirs && !merged && base.contentKind === "document" && theirs.body !== base.body) {
          this.#deps.onOverwrote?.(id, theirs.body);
        }
        return { updated, merged };
      } catch (e) {
        const conflict = e instanceof ApiError && e.code === ERROR_CODES.CONFLICT;
        if (!conflict || attempt >= CONFLICT_ATTEMPTS) throw e;
        theirs = await getNote(id, false);
        expected = theirs.updatedAt;
        if (base.contentKind === "sheet" && carrying.surfaceData !== undefined && theirs.surfaceData) {
          const { sheet, added } = mergeAppended(
            parseSheet(base.surfaceData),
            parseSheet(carrying.surfaceData),
            parseSheet(theirs.surfaceData),
          );
          if (added.length > 0) {
            carrying = { surfaceData: serializeSheet(sheet) };
            merged = [...(merged ?? []), ...added];
          }
        }
      }
    }
  }

  async #persist(id: string, edit: QueuedEdit, canRetry: boolean): Promise<void> {
    this.#clearRetryTimer(id);
    try {
      const { updated, merged } = await this.#write(id, edit);
      this.known(edit.surfaceData !== undefined ? { ...updated, surfaceData: edit.surfaceData } : updated);
      if (this.#unsaved.get(id) === edit) {
        this.#unsaved = withoutMapKeys(this.#unsaved, [id]);
      }
      if (this.#failed.has(id)) {
        this.#failed = withoutSetEntries(this.#failed, [id]);
      }
      if (merged) this.#deps.onMerged?.(id, merged);
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
