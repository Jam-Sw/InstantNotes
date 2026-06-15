// Library window state (Svelte 5 runes). The only mutation path is the API
// client; the store re-queries on core change events (single-writer model).

import {
  addNoteToWorkspace,
  addTagToNote,
  ApiError,
  createNote,
  deleteWorkspace,
  getNote,
  getOrCreateWorkspace,
  listNotes,
  listTags,
  listWorkspaces,
  permanentlyDeleteNote,
  removeNoteFromWorkspace,
  removeTagFromNote,
  restoreNote,
  searchNotes,
  softDeleteNote,
  tagsForNote,
  updateNote,
  workspacesForNote,
} from "$lib/api/client";
import type {
  Note,
  NoteFilter,
  SearchResult,
  Tag,
  TagWithCount,
  Workspace,
  WorkspaceWithCount,
} from "$lib/api/types";
import { debounce } from "$lib/debounce";
import { friendlyMessage } from "$lib/errors";
import { rangeSelection, stepId, toggleSelection } from "$lib/selection";
import { listen } from "@tauri-apps/api/event";

// Archived and trash live behind a list filter in All Notes, not as
// top-level sections (two-section library: All Notes and Workspaces).
export type StatusFilter = "active" | "archived" | "trash";

class LibraryStore {
  statusFilter = $state<StatusFilter>("active");
  activeWorkspaceId = $state<string | null>(null);
  activeTagId = $state<string | null>(null);
  searchText = $state("");
  notes = $state<Note[]>([]);
  searchResults = $state<SearchResult[] | null>(null);
  tags = $state<TagWithCount[]>([]);
  workspaces = $state<WorkspaceWithCount[]>([]);
  selected = $state<Note | null>(null);
  selectedTags = $state<Tag[]>([]);
  selectedWorkspaces = $state<Workspace[]>([]);
  // Ids checked for bulk actions. Holds the open note's id on a plain click;
  // grows via cmd-click / shift-click. Size > 1 swaps the editor for the
  // bulk-actions panel.
  multiSelected = $state<Set<string>>(new Set());
  error = $state<string | null>(null);
  loading = $state(false);
  // True while a body edit is queued or in flight, for the save indicator.
  saving = $state(false);

  #anchorId: string | null = null;

  #refreshDebounced = debounce(() => void this.refresh(), 50);
  #saveBody = debounce((id: string, body: string) => {
    void this.#applyUpdate(id, { body }).finally(() => {
      this.saving = false;
    });
  }, 400);

  async init(): Promise<void> {
    await Promise.all([
      this.refresh(),
      this.refreshTags(),
      this.refreshWorkspaces(),
    ]);
    await listen("notes:changed", () => this.#refreshDebounced());
    await listen("tags:changed", () => void this.refreshTags());
    await listen("workspaces:changed", () => void this.refreshWorkspaces());
  }

  #filter(): NoteFilter {
    const f: NoteFilter = {};
    if (this.statusFilter === "archived") f.isArchived = true;
    if (this.statusFilter === "trash") f.isDeleted = true;
    if (this.activeWorkspaceId) f.workspaceId = this.activeWorkspaceId;
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

  async refreshWorkspaces(): Promise<void> {
    try {
      this.workspaces = await listWorkspaces();
      // Live list refresh when the active workspace's contents changed.
      if (
        this.activeWorkspaceId &&
        !this.workspaces.some((w) => w.id === this.activeWorkspaceId)
      ) {
        this.selectWorkspace(null);
      }
    } catch (e) {
      this.#fail(e);
    }
  }

  setStatusFilter(filter: StatusFilter): void {
    this.statusFilter = filter;
    this.searchText = "";
    this.clearMultiSelect();
    void this.refresh();
  }

  /** Show All Notes (null) or one workspace's collected notes. */
  selectWorkspace(workspaceId: string | null): void {
    this.activeWorkspaceId = workspaceId;
    this.statusFilter = "active";
    this.activeTagId = null;
    this.searchText = "";
    this.clearMultiSelect();
    void this.refresh();
  }

  setTagFilter(tagId: string | null): void {
    this.activeTagId = tagId;
    this.activeWorkspaceId = null;
    this.statusFilter = "active";
    this.searchText = "";
    this.clearMultiSelect();
    void this.refresh();
  }

  setSearch(text: string): void {
    this.searchText = text;
    // Reset the multi-selection but keep the open note in the editor.
    this.multiSelected = this.selected ? new Set([this.selected.id]) : new Set();
    this.#anchorId = this.selected?.id ?? null;
    this.#lastRangeEnd = this.#anchorId;
    void this.refresh();
  }

  async select(id: string): Promise<void> {
    this.multiSelected = new Set([id]);
    this.#anchorId = id;
    this.#lastRangeEnd = id;
    await this.#open(id);
  }

  async #open(id: string): Promise<void> {
    // Flush any pending edit of the previous note before switching.
    this.#saveBody.flush();
    try {
      this.selected = await getNote(id, true);
      [this.selectedTags, this.selectedWorkspaces] = await Promise.all([
        tagsForNote(id),
        workspacesForNote(id),
      ]);
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  // ---- multi-selection ----

  get visibleIds(): string[] {
    return this.searchResults
      ? this.searchResults.map((h) => h.noteId)
      : this.notes.map((n) => n.id);
  }

  /** Notes backing the current multi-selection (normal list only). */
  get multiSelectedNotes(): Note[] {
    return this.notes.filter((n) => this.multiSelected.has(n.id));
  }

  isSelected(id: string): boolean {
    return this.multiSelected.has(id);
  }

  async toggleInSelection(id: string): Promise<void> {
    this.multiSelected = toggleSelection(this.multiSelected, id);
    this.#anchorId = id;
    this.#lastRangeEnd = id;
    await this.#syncEditorToSelection();
  }

  async extendSelectionTo(id: string): Promise<void> {
    this.multiSelected = rangeSelection(this.visibleIds, this.#anchorId, id);
    this.#lastRangeEnd = id;
    await this.#syncEditorToSelection();
  }

  async selectAllVisible(): Promise<void> {
    this.multiSelected = new Set(this.visibleIds);
    await this.#syncEditorToSelection();
  }

  /**
   * Arrow-key movement; `extend` grows the range from the anchor.
   * Returns the id the selection moved to so the view can reveal it.
   */
  async moveSelection(delta: number, extend = false): Promise<string | null> {
    const current =
      this.#lastRangeEnd ?? this.selected?.id ?? this.#anchorId;
    const next = stepId(this.visibleIds, current, delta);
    if (!next) return null;
    if (extend) {
      await this.extendSelectionTo(next);
    } else {
      await this.select(next);
    }
    return next;
  }

  // Active end of the selection: the last row clicked, toggled, or stepped to.
  // Shift+arrow continues from here rather than from the anchor.
  #lastRangeEnd: string | null = null;

  clearMultiSelect(): void {
    this.multiSelected = new Set();
    this.#anchorId = null;
    this.#lastRangeEnd = null;
    this.selected = null;
    this.selectedTags = [];
    this.selectedWorkspaces = [];
  }

  /** Keep the editor pane consistent with how many notes are checked. */
  async #syncEditorToSelection(): Promise<void> {
    const ids = [...this.multiSelected];
    if (ids.length === 1) {
      this.#anchorId = ids[0];
      this.#lastRangeEnd = ids[0];
      if (this.selected?.id !== ids[0]) await this.#open(ids[0]);
    } else {
      this.#saveBody.flush();
      this.selected = null;
      this.selectedTags = [];
      this.selectedWorkspaces = [];
    }
  }

  // ---- bulk actions ----

  async bulkSetPinned(isPinned: boolean): Promise<void> {
    await this.#bulk((id) => updateNote(id, { isPinned }).then(() => {}));
    this.clearMultiSelect();
  }

  async bulkSetArchived(isArchived: boolean): Promise<void> {
    await this.#bulk((id) => updateNote(id, { isArchived }).then(() => {}));
    this.clearMultiSelect();
  }

  async bulkDelete(): Promise<void> {
    this.#saveBody.cancel();
    await this.#bulk((id) => softDeleteNote(id).then(() => {}));
    this.clearMultiSelect();
  }

  async bulkRestore(): Promise<void> {
    await this.#bulk((id) => restoreNote(id).then(() => {}));
    this.clearMultiSelect();
  }

  async bulkDestroy(): Promise<void> {
    await this.#bulk((id) => permanentlyDeleteNote(id, true));
    this.clearMultiSelect();
  }

  async emptyTrash(): Promise<void> {
    try {
      const trashed = await listNotes({ isDeleted: true });
      for (const note of trashed) {
        await permanentlyDeleteNote(note.id, true);
      }
      this.clearMultiSelect();
    } catch (e) {
      this.#fail(e);
    }
  }

  async #bulk(op: (id: string) => Promise<void>): Promise<void> {
    try {
      for (const id of this.multiSelected) {
        await op(id);
      }
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  async newNote(): Promise<void> {
    try {
      const note = await createNote({});
      // A note born inside a workspace joins it; the view stays put.
      if (this.activeWorkspaceId) {
        await addNoteToWorkspace(note.id, this.activeWorkspaceId);
      }
      this.statusFilter = "active";
      this.activeTagId = null;
      this.searchText = "";
      void this.refresh();
      await this.select(note.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  // ---- workspaces ----

  async createWorkspace(name: string): Promise<void> {
    if (!name.trim()) return;
    try {
      const ws = await getOrCreateWorkspace(name);
      this.selectWorkspace(ws.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Delete a workspace; its notes are kept. */
  async removeWorkspace(id: string): Promise<void> {
    try {
      await deleteWorkspace(id);
      if (this.activeWorkspaceId === id) this.selectWorkspace(null);
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Collect the open note into a workspace by name (created if missing). */
  async addSelectedToWorkspace(name: string): Promise<void> {
    if (!this.selected || !name.trim()) return;
    try {
      const ws = await getOrCreateWorkspace(name);
      await addNoteToWorkspace(this.selected.id, ws.id);
      this.selectedWorkspaces = await workspacesForNote(this.selected.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async removeSelectedFromWorkspace(workspaceId: string): Promise<void> {
    if (!this.selected) return;
    try {
      await removeNoteFromWorkspace(this.selected.id, workspaceId);
      this.selectedWorkspaces = await workspacesForNote(this.selected.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  editBody(body: string): void {
    if (!this.selected) return;
    // Optimistic local state; persistence is debounced.
    this.selected.body = body;
    this.saving = true;
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
    this.saving = false;
    try {
      await softDeleteNote(this.selected.id);
      this.clearMultiSelect();
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
      this.clearMultiSelect();
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
