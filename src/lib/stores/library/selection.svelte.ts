import { rangeSelection, stepId, toggleSelection } from "$lib/selection";

export class SelectionModel {
  ids = $state<Set<string>>(new Set());

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

  step(delta: number, fallback: string | null): string | null {
    const current = this.#activeEnd ?? fallback ?? this.#anchor;
    return stepId(this.#visibleIds(), current, delta);
  }

  setActive(id: string): void {
    this.#anchor = id;
    this.#activeEnd = id;
  }
}
