import { getSetting, setSetting } from "$lib/api/client";
import type { NoteFilter } from "$lib/api/types";

const KEY_SORT_BY = "list.sortBy";
const KEY_SORT_ORDER = "list.sortOrder";
const KEY_PREVIEW = "list.previewChars";
const KEY_RECENT = "list.recentCount";
const KEY_REOPEN = "list.reopenLast";
export const KEY_LAST_NOTE = "list.lastNote";

export type ListSortBy = "updatedAt" | "createdAt" | "lastOpenedAt" | "title";
export type ListSortOrder = "desc" | "asc";

export const PREVIEW_RANGE = { min: 40, max: 300, step: 10 } as const;
export const RECENT_RANGE = { min: 3, max: 20 } as const;

const SORT_BY: readonly ListSortBy[] = ["updatedAt", "createdAt", "lastOpenedAt", "title"];

const isSortBy = (v: unknown): v is ListSortBy => SORT_BY.includes(v as ListSortBy);
const isSortOrder = (v: unknown): v is ListSortOrder => v === "desc" || v === "asc";
const inRange = (v: unknown, r: { min: number; max: number }): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;
const clamp = (v: number, r: { min: number; max: number }) =>
  Math.min(r.max, Math.max(r.min, Math.round(v)));

export const LIST_DEFAULTS: {
  sortBy: ListSortBy;
  sortOrder: ListSortOrder;
  previewChars: number;
  recentCount: number;
  reopenLast: boolean;
} = { sortBy: "updatedAt", sortOrder: "desc", previewChars: 90, recentCount: 5, reopenLast: false };

class ListPrefs {
  sortBy = $state<ListSortBy>(LIST_DEFAULTS.sortBy);
  sortOrder = $state<ListSortOrder>(LIST_DEFAULTS.sortOrder);
  previewChars = $state(LIST_DEFAULTS.previewChars);
  recentCount = $state(LIST_DEFAULTS.recentCount);
  reopenLast = $state(LIST_DEFAULTS.reopenLast);

  #loaded = false;
  #touched = new Set<string>();

  sort(): NoteFilter {
    const f: NoteFilter = {};
    if (this.sortBy !== LIST_DEFAULTS.sortBy) f.sortBy = this.sortBy;
    if (this.sortOrder !== LIST_DEFAULTS.sortOrder) f.sortOrder = this.sortOrder;
    return f;
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [by, order, preview, recent, reopen] = await Promise.all([
        getSetting<string>(KEY_SORT_BY),
        getSetting<string>(KEY_SORT_ORDER),
        getSetting<number>(KEY_PREVIEW),
        getSetting<number>(KEY_RECENT),
        getSetting<boolean>(KEY_REOPEN),
      ]);
      if (!this.#touched.has(KEY_REOPEN) && typeof reopen === "boolean") this.reopenLast = reopen;
      if (!this.#touched.has(KEY_SORT_BY) && isSortBy(by)) this.sortBy = by;
      if (!this.#touched.has(KEY_SORT_ORDER) && isSortOrder(order)) this.sortOrder = order;
      if (!this.#touched.has(KEY_PREVIEW) && inRange(preview, PREVIEW_RANGE)) {
        this.previewChars = preview;
      }
      if (!this.#touched.has(KEY_RECENT) && inRange(recent, RECENT_RANGE)) {
        this.recentCount = recent;
      }
    } catch {
    }
  }

  async reload(): Promise<void> {
    this.#loaded = false;
    this.#touched.clear();
    await this.init();
  }

  setSortBy(v: ListSortBy): void {
    this.#touched.add(KEY_SORT_BY);
    this.sortBy = v;
    void setSetting(KEY_SORT_BY, v);
  }

  setSortOrder(v: ListSortOrder): void {
    this.#touched.add(KEY_SORT_ORDER);
    this.sortOrder = v;
    void setSetting(KEY_SORT_ORDER, v);
  }

  setPreviewChars(v: number): void {
    this.#touched.add(KEY_PREVIEW);
    this.previewChars = clamp(v, PREVIEW_RANGE);
    void setSetting(KEY_PREVIEW, this.previewChars);
  }

  setRecentCount(v: number): void {
    this.#touched.add(KEY_RECENT);
    this.recentCount = clamp(v, RECENT_RANGE);
    void setSetting(KEY_RECENT, this.recentCount);
  }

  setReopenLast(v: boolean): void {
    this.#touched.add(KEY_REOPEN);
    this.reopenLast = v;
    void setSetting(KEY_REOPEN, v);
  }
}

export const listPrefs = new ListPrefs();
