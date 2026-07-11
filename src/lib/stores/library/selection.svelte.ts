// The list multi-selection: which note ids are checked, plus the anchor and
// active end that shift-range and arrow-step read from. The open note itself
// (selected / selectedTags / selectedWorkspaces) stays in the store; this owns
// only the checkbox set and its navigation cursor.
//
// The current visible id list is injected (it depends on the store's filter /
// search results), so this class never reaches into query state.

import { rangeSelection, stepId, toggleSelection } from "$lib/selection";

export class SelectionModel {
  ids = $state<Set<string>>(new Set());

  // The row a range grows from, and the last row acted on. Shift+arrow
  // continues from the active end rather than from the anchor.
  #anchor: string | null = null;
  #activeEnd: string | null = null;

  #visibleIds: () => string[];

  constructor(visibleIds: () => string[]) {
    this.#visibleIds = visibleIds;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get anchor(): string | null {
    return this.#anchor;
  }

  /** Replace the selection with exactly these ids, anchored at `anchor`. */
  reset(ids: string[], anchor: string | null): void {
    this.ids = new Set(ids);
    this.#anchor = anchor;
    this.#activeEnd = anchor;
  }

  clear(): void {
    this.reset([], null);
  }

  toggle(id: string): void {
    this.ids = toggleSelection(this.ids, id);
    this.#anchor = id;
    this.#activeEnd = id;
  }

  extendTo(id: string): void {
    this.ids = rangeSelection(this.#visibleIds(), this.#anchor, id);
    this.#activeEnd = id;
  }

  selectAll(): void {
    this.ids = new Set(this.#visibleIds());
  }

  /** Next id when stepping by `delta` from the active end (falling back to the
   *  open note, then the anchor); null at the edge of the visible list. */
  step(delta: number, fallback: string | null): string | null {
    const current = this.#activeEnd ?? fallback ?? this.#anchor;
    return stepId(this.#visibleIds(), current, delta);
  }

  /** Pin both cursor ends to one id (a single row became the selection). */
  setActive(id: string): void {
    this.#anchor = id;
    this.#activeEnd = id;
  }
}
