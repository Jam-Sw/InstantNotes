import {
  clearMergeReview,
  getMergeReview,
  getNote,
  settleMergePair,
  undoMergeCombine,
} from "$lib/api/client";
import { EVENTS, listen } from "$lib/api/events";
import type { MergeReview, Note } from "$lib/api/types";
import { library } from "$lib/stores/library.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { friendlyError } from "$lib/errors";
import {
  buildMergeNotes,
  COPIES_NOTE_ID,
  MERGE_SPACE_ID,
  pairNoteId,
  type MergePair,
} from "$lib/merge/space";

const EMPTY: MergeReview = { combined: [], pairs: [] };

class MergeSpace {
  review = $state<MergeReview>(EMPTY);
  known = $state<Record<string, Note>>({});
  #started = false;

  get visible(): boolean {
    return this.review.combined.length > 0 || this.review.pairs.length > 0;
  }

  get notes(): Note[] {
    return buildMergeNotes(this.review, this.known);
  }

  pairFor(noteId: string | null | undefined): MergePair | null {
    return this.review.pairs.find((p) => pairNoteId(p) === noteId) ?? null;
  }

  async init(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await listen(EVENTS.VAULT_STATUS, () => void this.refresh());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      await this.#adopt(await getMergeReview());
    } catch {
    }
  }

  open(): void {
    library.selectWorkspace(MERGE_SPACE_ID);
    const lead = this.notes[0];
    if (lead) library.selectVirtual(lead);
    void this.refresh();
  }

  async settle(pair: MergePair, keep: string | null): Promise<void> {
    try {
      await this.#adopt(await settleMergePair(pair.a, pair.b, keep));
      this.#showNext();
    } catch (e) {
      toasts.show(`Couldn't settle this pair. ${friendlyError(e)}`);
    }
  }

  async undo(trashed: string): Promise<void> {
    try {
      await this.#adopt(await undoMergeCombine(trashed));
      this.#showNext();
    } catch (e) {
      toasts.show(`Couldn't undo. ${friendlyError(e)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      await clearMergeReview();
      this.review = EMPTY;
    } catch (e) {
      toasts.show(`Couldn't clear the list. ${friendlyError(e)}`);
    }
  }

  async #adopt(review: MergeReview): Promise<void> {
    const ids = new Set([
      ...review.combined.flatMap((c) => [c.kept, c.trashed]),
      ...review.pairs.flatMap((p) => [p.a, p.b]),
    ]);
    const found = await Promise.allSettled([...ids].map((id) => getNote(id)));
    const known: Record<string, Note> = {};
    for (const result of found) {
      if (result.status === "fulfilled") known[result.value.id] = result.value;
    }
    this.known = known;
    this.review = review;
  }

  #showNext(): void {
    const open = library.selected?.id;
    const notes = this.notes;
    if (!this.visible || notes.some((n) => n.id === open)) return;
    const next = notes.find((n) => n.id !== COPIES_NOTE_ID) ?? notes[0];
    if (next) library.selectVirtual(next);
  }
}

export const mergeSpace = new MergeSpace();
