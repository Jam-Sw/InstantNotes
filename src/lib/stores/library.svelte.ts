// Library window state (Svelte 5 runes). The only mutation path is the API
// client; the store re-queries on core change events (single-writer model).

import {
  addTagToNote,
  ApiError,
  createNote,
  getNote,
  listNotes,
  listTags,
  permanentlyDeleteNote,
  removeTagFromNote,
  restoreNote,
  searchNotes,
  softDeleteNote,
  tagsForNote,
  updateNote,
} from "$lib/api/client";
import type {
  Note,
  NoteFilter,
  SearchResult,
  Tag,
  TagWithCount,
} from "$lib/api/types";
import { debounce } from "$lib/debounce";
import { friendlyMessage } from "$lib/errors";
import { listen } from "@tauri-apps/api/event";

export type Section = "all" | "pinned" | "archived" | "trash";

class LibraryStore {
  section = $state<Section>("all");
  activeTagId = $state<string | null>(null);
  searchText = $state("");
  notes = $state<Note[]>([]);
  searchResults = $state<SearchResult[] | null>(null);
  tags = $state<TagWithCount[]>([]);
  selected = $state<Note | null>(null);
  selectedTags = $state<Tag[]>([]);
  error = $state<string | null>(null);
  loading = $state(false);

  #refreshDebounced = debounce(() => void this.refresh(), 50);
  #saveBody = debounce((id: string, body: string) => {
    void this.#applyUpdate(id, { body });
  }, 400);

  async init(): Promise<void> {
    await Promise.all([this.refresh(), this.refreshTags()]);
    await listen("notes:changed", () => this.#refreshDebounced());
    await listen("tags:changed", () => void this.refreshTags());
  }

  #filter(): NoteFilter {
    const f: NoteFilter = {};
    if (this.section === "pinned") f.isPinned = true;
    if (this.section === "archived") f.isArchived = true;
    if (this.section === "trash") f.isDeleted = true;
    if (this.activeTagId) f.tagIds = [this.activeTagId];
    return f;
  }

  async refresh(): Promise<void> {
    try {
      const text = this.searchText.trim();
      if (text) {
        this.searchResults = await searchNotes(text);
      } else {
        this.searchResults = null;
        this.notes = await listNotes(this.#filter());
      }
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  async refreshTags(): Promise<void> {
    try {
      this.tags = await listTags();
    } catch (e) {
      this.#fail(e);
    }
  }

  setSection(section: Section): void {
    this.section = section;
    this.activeTagId = null;
    this.searchText = "";
    void this.refresh();
  }

  setTagFilter(tagId: string | null): void {
    this.activeTagId = tagId;
    this.section = "all";
    this.searchText = "";
    void this.refresh();
  }

  setSearch(text: string): void {
    this.searchText = text;
    void this.refresh();
  }

  async select(id: string): Promise<void> {
    // Flush any pending edit of the previous note before switching.
    this.#saveBody.flush();
    try {
      this.selected = await getNote(id, true);
      this.selectedTags = await tagsForNote(id);
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  async newNote(): Promise<void> {
    try {
      const note = await createNote({});
      this.setSection("all");
      await this.select(note.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  editBody(body: string): void {
    if (!this.selected) return;
    // Optimistic local state; persistence is debounced.
    this.selected.body = body;
    this.#saveBody(this.selected.id, body);
  }

  editTitle(title: string): void {
    if (!this.selected) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === this.selected.title) return;
    void this.#applyUpdate(this.selected.id, { title: trimmed });
  }

  async togglePinned(): Promise<void> {
    if (!this.selected) return;
    await this.#applyUpdate(this.selected.id, {
      isPinned: !this.selected.isPinned,
    });
  }

  async toggleArchived(): Promise<void> {
    if (!this.selected) return;
    await this.#applyUpdate(this.selected.id, {
      isArchived: !this.selected.isArchived,
    });
  }

  async deleteSelected(): Promise<void> {
    if (!this.selected) return;
    this.#saveBody.cancel();
    try {
      await softDeleteNote(this.selected.id);
      this.selected = null;
      this.selectedTags = [];
    } catch (e) {
      this.#fail(e);
    }
  }

  async restoreSelected(): Promise<void> {
    if (!this.selected) return;
    try {
      this.selected = await restoreNote(this.selected.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async destroySelected(): Promise<void> {
    if (!this.selected) return;
    try {
      await permanentlyDeleteNote(this.selected.id, true);
      this.selected = null;
      this.selectedTags = [];
    } catch (e) {
      this.#fail(e);
    }
  }

  async addTag(name: string): Promise<void> {
    if (!this.selected || !name.trim()) return;
    try {
      await addTagToNote(this.selected.id, name);
      this.selectedTags = await tagsForNote(this.selected.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async removeTag(tagId: string): Promise<void> {
    if (!this.selected) return;
    try {
      await removeTagFromNote(this.selected.id, tagId);
      this.selectedTags = await tagsForNote(this.selected.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  flushPendingEdits(): void {
    this.#saveBody.flush();
  }

  async #applyUpdate(
    id: string,
    patch: Parameters<typeof updateNote>[1],
  ): Promise<void> {
    try {
      const updated = await updateNote(id, patch);
      if (this.selected?.id === id) {
        // Keep local body if user kept typing past this save.
        const localBody = this.selected.body;
        this.selected = { ...updated, body: patch.body ?? localBody };
        this.selectedTags = await tagsForNote(id);
      }
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  #fail(e: unknown): void {
    this.error =
      e instanceof ApiError
        ? friendlyMessage(e.code, e.message)
        : friendlyMessage("");
  }
}

export const library = new LibraryStore();
