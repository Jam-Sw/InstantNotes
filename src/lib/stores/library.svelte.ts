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
  listWorkspaceTags,
  removeNoteFromWorkspace,
  removeTagFromNote,
  renameWorkspace,
  restoreNote,
  searchNotes,
  softDeleteNote,
  softDeleteNotes,
  restoreNotes,
  setNotesFlags,
  destroyNotes as destroyNotesCmd,
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
import {
  withMapEntry,
  withoutMapKeys,
  withSetEntry,
  withoutSetEntries,
} from "$lib/reactive-collections";
import { friendlyMessage } from "$lib/errors";
import { rangeSelection, stepId, toggleSelection } from "$lib/selection";
import { toasts } from "$lib/stores/toasts.svelte";
import { listen } from "@tauri-apps/api/event";

// Archived and trash live behind a list filter in All Notes, not as
// top-level sections (two-section library: All Notes and Workspaces).
export type StatusFilter = "active" | "archived" | "trash";

// One quiet retry this long after a failed body save; most failures (a
// competing writer briefly holding the database lock) clear well within it.
const SAVE_RETRY_MS = 2000;

// Debounce for search-text refreshes only, so a query runs per pause rather
// than per keystroke; filter clicks and change events stay immediate.
const SEARCH_DEBOUNCE_MS = 150;

/** Selected-note save status for the editor status bar. */
export type SaveState = "saved" | "saving" | "failed";

// A capture-born note that nobody has opened within this window is an open
// loop worth resurfacing. Newer captures aren't nagged about: they're often
// still in the user's head, and Revisit must never feel like a task manager.
const REVISIT_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

class LibraryStore {
  statusFilter = $state<StatusFilter>("active");
  activeWorkspaceId = $state<string | null>(null);
  activeTagId = $state<string | null>(null);
  // Tag filter applied within the active workspace (the note list's chip
  // row). Composes with activeWorkspaceId; the global activeTagId replaces
  // the workspace instead.
  scopedTagId = $state<string | null>(null);
  // Tags carried by the active workspace's visible notes; drives the chips.
  workspaceTags = $state<TagWithCount[]>([]);
  // Revisit: capture-born notes never opened in the library. The count keeps
  // the sidebar entry honest (hidden at zero); the mode filters the list.
  revisitMode = $state(false);
  revisitCount = $state(0);
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

  // Bodies not yet confirmed persisted, by note id. An entry is only removed
  // by a successful write, so a failed save stays queued for the next flush
  // (note switch, blur, quit) instead of being silently dropped. Reassigned
  // on change, like multiSelected, so the status bar tracks it reactively.
  #unsaved = $state(new Map<string, string>());
  // Note ids whose save failed even after the retry; drives "Not saved".
  #failed = $state(new Set<string>());
  // Scheduled 2s retry per note id, so a newer write, a drop, or a flush can
  // cancel it before it fires a stray write behind the caller's back.
  #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  #anchorId: string | null = null;
  #initialized = false;

  #refreshDebounced = debounce(() => void this.refresh(), 50);
  // The revisit count rides the same 50ms window so a burst of change
  // events (bulk delete, undo) costs one count query, not one per event.
  #revisitCountDebounced = debounce(() => void this.#refreshRevisitCount(), 50);
  #searchRefresh = debounce(() => void this.refresh(), SEARCH_DEBOUNCE_MS);
  #saveBody = debounce((id: string, body: string) => {
    void this.#persistBody(id, body, true);
  }, 400);

  /** Save status of the selected note, for the editor status bar. */
  get saveState(): SaveState {
    const id = this.selected?.id;
    if (!id || !this.#unsaved.has(id)) return "saved";
    return this.#failed.has(id) ? "failed" : "saving";
  }

  async init(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    // Listeners before the initial fetches: a change event arriving during
    // startup must trigger a re-query, not be dropped.
    await Promise.all([
      listen("notes:changed", () => {
        this.#refreshDebounced();
        this.#revisitCountDebounced();
      }),
      listen("tags:changed", () => void this.refreshTags()),
      listen("workspaces:changed", () => void this.refreshWorkspaces()),
    ]);
    await Promise.all([
      this.refresh(),
      this.refreshTags(),
      this.refreshWorkspaces(),
      this.#refreshRevisitCount(),
    ]);
  }

  #filter(): NoteFilter {
    if (this.revisitMode) return this.#revisitFilter();
    const f: NoteFilter = {};
    if (this.statusFilter === "archived") f.isArchived = true;
    if (this.statusFilter === "trash") f.isDeleted = true;
    if (this.activeWorkspaceId) {
      f.workspaceId = this.activeWorkspaceId;
      if (this.scopedTagId) f.tagIds = [this.scopedTagId];
    }
    if (this.activeTagId) f.tagIds = [this.activeTagId];
    return f;
  }

  // Oldest first: the longest-parked loop is the one to burn down first.
  #revisitFilter(): NoteFilter {
    return {
      neverOpened: true,
      createdBefore: new Date(Date.now() - REVISIT_AFTER_MS).toISOString(),
      sortBy: "createdAt",
      sortOrder: "asc",
    };
  }

  // Monotonic refresh token: queries answer out of order (search per pause,
  // list per filter click), so a response only lands while it is still the
  // newest request; a slow earlier reply can never clobber a later one.
  #refreshToken = 0;

  async refresh(): Promise<void> {
    const token = ++this.#refreshToken;
    try {
      const text = this.searchText.trim();
      if (text) {
        const results = await searchNotes(text);
        if (token !== this.#refreshToken) return;
        this.searchResults = results;
      } else {
        const notes = await listNotes(this.#filter());
        if (token !== this.#refreshToken) return;
        this.searchResults = null;
        this.notes = notes;
      }
      this.error = null;
      // In revisit mode the main list IS the revisit query, so the count
      // stays in lockstep with the burn-down for free.
      if (this.revisitMode && !this.searchResults) {
        this.revisitCount = this.notes.length;
      }
      // Chips ride along on every refresh: notes:changed also fires when a
      // note's inline tags change, which is exactly when they go stale.
      if (this.activeWorkspaceId) {
        void this.#refreshWorkspaceTags();
      } else if (this.workspaceTags.length > 0) {
        this.workspaceTags = [];
      }
    } catch (e) {
      if (token !== this.#refreshToken) return;
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
    // Status (All / Archived / Trash) composes with the active space or tag,
    // so it clears revisit and search but keeps the space/tag scope.
    this.statusFilter = filter;
    this.revisitMode = false;
    this.searchText = "";
    this.clearMultiSelect();
    void this.refresh();
  }

  /**
   * Clear every primary filter dimension so a caller can set exactly one.
   * The space, tag, and revisit views are mutually exclusive; each entry
   * point resets the rest, drops any scoped tag, and clears search and the
   * multi-selection before choosing its own dimension.
   */
  #resetForNavigation(): void {
    this.activeWorkspaceId = null;
    this.activeTagId = null;
    this.scopedTagId = null;
    this.workspaceTags = [];
    this.revisitMode = false;
    this.statusFilter = "active";
    this.searchText = "";
    this.clearMultiSelect();
  }

  /** Show All Notes (null) or one workspace's collected notes. */
  selectWorkspace(workspaceId: string | null): void {
    this.#resetForNavigation();
    this.activeWorkspaceId = workspaceId;
    void this.refresh();
  }

  /** Show the open loops: capture-born notes never opened in the library. */
  selectRevisit(): void {
    this.#resetForNavigation();
    this.revisitMode = true;
    void this.refresh();
  }

  setTagFilter(tagId: string | null): void {
    this.#resetForNavigation();
    this.activeTagId = tagId;
    void this.refresh();
  }

  /**
   * Re-count the open loops (never-opened captures old enough to matter).
   * Cheap and quiet: a failed count only affects a sidebar hint, and the
   * next change event retries it.
   */
  async #refreshRevisitCount(): Promise<void> {
    try {
      const loops = await listNotes(this.#revisitFilter());
      this.revisitCount = loops.length;
    } catch {
      // Keep the stale count rather than surface an error for a hint.
    }
  }

  /** Toggle a chip: filter the active workspace's list by one of its tags. */
  toggleScopedTag(tagId: string): void {
    if (!this.activeWorkspaceId) return;
    this.scopedTagId = this.scopedTagId === tagId ? null : tagId;
    this.clearMultiSelect();
    void this.refresh();
  }

  /**
   * Re-query the chip row for the active workspace. The scoped tag is
   * dropped when it no longer exists on the workspace's visible notes: a
   * chip that vanished must not keep filtering the list.
   */
  async #refreshWorkspaceTags(): Promise<void> {
    const id = this.activeWorkspaceId;
    if (!id) {
      this.workspaceTags = [];
      return;
    }
    try {
      const tags = await listWorkspaceTags(id);
      if (this.activeWorkspaceId !== id) return; // switched away mid-flight
      this.workspaceTags = tags;
      if (this.scopedTagId && !tags.some((t) => t.id === this.scopedTagId)) {
        this.scopedTagId = null;
        void this.refresh();
      }
    } catch (e) {
      if (this.activeWorkspaceId !== id) return;
      this.workspaceTags = [];
      // The workspace can be deleted between the list refresh and this
      // query; refreshWorkspaces resets the selection, nothing to surface.
      if (!(e instanceof ApiError && e.code === "NOT_FOUND")) this.#fail(e);
    }
  }

  setSearch(text: string): void {
    this.searchText = text;
    // Reset the multi-selection but keep the open note in the editor.
    this.multiSelected = this.selected
      ? new Set([this.selected.id])
      : new Set();
    this.#anchorId = this.selected?.id ?? null;
    this.#lastRangeEnd = this.#anchorId;
    if (text.trim()) {
      this.#searchRefresh();
    } else {
      // Clearing must feel instant: drop any pending keystroke debounce and
      // go straight back to the list.
      this.#searchRefresh.cancel();
      void this.refresh();
    }
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
      const note = await getNote(id, true);
      // A queued edit (debounced or awaiting retry) is newer than what disk
      // returned; showing the disk body would fork the note's history.
      const queued = this.#unsaved.get(id);
      this.selected = queued !== undefined ? { ...note, body: queued } : note;
      [this.selectedTags, this.selectedWorkspaces] = await Promise.all([
        tagsForNote(id),
        workspacesForNote(id),
      ]);
      this.error = null;
      // The touch in getNote released this note from the Revisit filter;
      // get_note emits no change event, so sync the count (and, in revisit
      // mode, the list burn-down) here.
      void this.#refreshRevisitCount();
      if (this.revisitMode) void this.refresh();
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
    const current = this.#lastRangeEnd ?? this.selected?.id ?? this.#anchorId;
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
    await this.#bulk((ids) => setNotesFlags(ids, { isPinned }));
    this.clearMultiSelect();
  }

  async bulkSetArchived(isArchived: boolean): Promise<void> {
    await this.#bulk((ids) => setNotesFlags(ids, { isArchived }));
    this.clearMultiSelect();
  }

  async bulkDelete(): Promise<void> {
    const ids = [...this.multiSelected];
    // Trash is reversible and Undo promises fidelity: persist any pending
    // edit first, so a restored note holds the user's last keystrokes.
    this.#saveBody.cancel();
    await this.#flushIds(ids);
    this.#dropQueued(...ids);
    await this.#bulk((sel) => softDeleteNotes(sel));
    this.clearMultiSelect();
    if (ids.length > 0) {
      const label = ids.length === 1 ? "1 note" : `${ids.length} notes`;
      toasts.show(`${label} moved to Trash`, {
        label: "Undo",
        run: () => void this.#undoSoftDelete(ids),
      });
    }
  }

  async bulkRestore(): Promise<void> {
    await this.#bulk((ids) => restoreNotes(ids));
    this.clearMultiSelect();
  }

  async bulkDestroy(): Promise<void> {
    await this.destroyNotes([...this.multiSelected]);
  }

  /**
   * Permanently delete an explicit set of notes. Ids are an argument rather
   * than a read of the live selection so confirm dialogs can snapshot them
   * at ask time: the selection must not be able to drift between the dialog
   * opening and the user confirming.
   */
  async destroyNotes(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    // Destroyed notes must also forget their queued edits, or the retry and
    // every later flush re-attempts a write against a row that no longer
    // exists and surfaces NOT_FOUND forever.
    this.#saveBody.cancel();
    this.#dropQueued(...ids);
    try {
      await destroyNotesCmd(ids, true);
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
    this.clearMultiSelect();
  }

  async emptyTrash(): Promise<void> {
    try {
      const trashed = await listNotes({ isDeleted: true });
      this.#saveBody.cancel();
      this.#dropQueued(...trashed.map((n) => n.id));
      await destroyNotesCmd(
        trashed.map((n) => n.id),
        true,
      );
      this.clearMultiSelect();
      if (trashed.length > 0) toasts.show("Trash emptied");
    } catch (e) {
      this.#fail(e);
    }
  }

  async #bulk(op: (ids: string[]) => Promise<void>): Promise<void> {
    try {
      await op([...this.multiSelected]);
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  async newNote(): Promise<void> {
    try {
      const activeTag = this.activeTagId
        ? this.tags.find((t) => t.id === this.activeTagId)
        : null;

      const note = await createNote(
        activeTag ? { tags: [activeTag.name] } : {},
      );
      // A note born inside a workspace joins it; the view stays put.
      if (this.activeWorkspaceId) {
        await addNoteToWorkspace(note.id, this.activeWorkspaceId);
      }
      this.statusFilter = "active";
      // A brand-new note can never match the Revisit filter (it is neither
      // old nor forgotten), so leaving the mode on would hide the note the
      // user just asked for. Exit it, exactly like trash and archived above.
      this.revisitMode = false;
      if (!activeTag) this.activeTagId = null;
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

  /**
   * Delete a workspace; its notes are kept. Immediate, with an Undo toast:
   * the operation never destroys note data, so it earns the reversible-action
   * treatment instead of a confirm dialog.
   */
  async removeWorkspace(id: string): Promise<void> {
    const ws = this.workspaces.find((w) => w.id === id);
    try {
      const memberIds = await deleteWorkspace(id);
      if (this.activeWorkspaceId === id) this.selectWorkspace(null);
      // An open note's membership chips may have shown this workspace.
      if (this.selected) {
        this.selectedWorkspaces = await workspacesForNote(this.selected.id);
      }
      await this.refreshWorkspaces();
      if (ws) {
        toasts.show(`Deleted "${ws.name}" - notes are kept`, {
          label: "Undo",
          run: () => void this.#undoWorkspaceDelete(ws.name, memberIds),
        });
      }
    } catch (e) {
      this.#fail(e);
    }
  }

  /**
   * Undo for a workspace delete: recreate it by name and re-add every
   * member. The ids come from the backend at delete time so archived and
   * trashed members are restored too; a member destroyed in the meantime
   * fails quietly into a plain toast rather than throwing back into the
   * toast's action handler.
   */
  async #undoWorkspaceDelete(name: string, memberIds: string[]): Promise<void> {
    try {
      const ws = await getOrCreateWorkspace(name);
      const results = await Promise.allSettled(
        memberIds.map((noteId) => addNoteToWorkspace(noteId, ws.id)),
      );
      await this.refreshWorkspaces();
      if (this.selected) {
        this.selectedWorkspaces = await workspacesForNote(this.selected.id);
      }
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        toasts.show(
          `Restored "${name}" without ${failedCount} of ${memberIds.length} notes.`,
        );
      }
    } catch {
      toasts.show(`Couldn't restore "${name}".`);
    }
  }

  /**
   * Rename a workspace. Returns an inline-error shape rather than throwing
   * so the row's edit state can show a duplicate-name rejection in place,
   * mirroring the Sidebar's tag rename.
   */
  async renameWorkspace(
    id: string,
    name: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await renameWorkspace(id, name);
      await this.refreshWorkspaces();
      // An open note's membership chips may display the old name.
      if (this.selected) {
        this.selectedWorkspaces = await workspacesForNote(this.selected.id);
      }
      return { ok: true };
    } catch (e) {
      const message =
        e instanceof ApiError
          ? friendlyMessage(e.code, e.message)
          : friendlyMessage("");
      return { ok: false, message };
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
    // Optimistic local state; persistence is debounced. The note is dirty
    // from this moment until a write of this (or a newer) body succeeds.
    this.selected.body = body;
    this.#unsaved = withMapEntry(this.#unsaved, this.selected.id, body);
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
    const id = this.selected.id;
    // Trash is reversible and Undo promises fidelity: persist any pending
    // edit first, so a restored note holds the user's last keystrokes.
    this.#saveBody.cancel();
    await this.#flushIds([id]);
    this.#dropQueued(id);
    try {
      await softDeleteNote(id);
      this.clearMultiSelect();
      toasts.show("Moved to Trash", {
        label: "Undo",
        run: () => void this.#undoSoftDelete([id]),
      });
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
    await this.destroyNotes([this.selected.id]);
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

  /**
   * Persist every queued edit now (note switch, window blur, export, quit).
   * Resolves once the writes have settled; anything that still fails stays
   * queued for the next flush.
   *
   * Cancels the debounce outright rather than flushing through it: flushing
   * would run the retry-enabled path, which schedules its own 2s retry on
   * failure and can fire a stray write after this call has already
   * resolved. #unsaved already holds the latest body for every queued note
   * (editBody sets it synchronously, ahead of the debounce), so a single
   * no-retry persist below covers the just-typed edit too, with exactly one
   * write attempt per note.
   */
  async flushPendingEdits(): Promise<void> {
    this.#saveBody.cancel();
    await Promise.all(
      [...this.#unsaved.entries()].map(([id, body]) =>
        this.#persistBody(id, body, false),
      ),
    );
  }

  /**
   * Persist queued edits for specific ids now, no retry. Used ahead of a
   * soft delete: the note survives in the trash, so the last keystrokes
   * must land before the row leaves the list (Undo depends on them).
   */
  async #flushIds(ids: string[]): Promise<void> {
    await Promise.all(
      ids
        .filter((id) => this.#unsaved.has(id))
        .map((id) =>
          this.#persistBody(id, this.#unsaved.get(id) as string, false),
        ),
    );
  }

  /**
   * Write one note body. A failure retries once after a short backoff (state
   * stays "saving", so the UI never claims "Saved" over unpersisted data);
   * a second failure flips the note to "failed" while keeping the edit in
   * #unsaved so a later flush still attempts it.
   */
  async #persistBody(
    id: string,
    body: string,
    canRetry: boolean,
  ): Promise<void> {
    // Any write attempt for this id, whether from the debounce, a retry, or
    // a flush, supersedes an outstanding scheduled retry for the same id.
    this.#clearRetryTimer(id);
    try {
      const updated = await updateNote(id, { body });
      // Confirmed on disk. Clear the queue entry unless a newer edit
      // superseded the body this write carried.
      if (this.#unsaved.get(id) === body) {
        this.#unsaved = withoutMapKeys(this.#unsaved, [id]);
      }
      if (this.#failed.has(id)) {
        this.#failed = withoutSetEntries(this.#failed, [id]);
      }
      if (this.selected?.id === id) {
        // Keep local body if user kept typing past this save.
        const localBody = this.selected.body;
        this.selected = { ...updated, body: localBody };
        this.selectedTags = await tagsForNote(id);
      }
      this.error = null;
    } catch (e) {
      if (canRetry) {
        // One quiet retry: most failures (a competing writer briefly holding
        // the database lock) clear well within the backoff. Tracked so a
        // drop or a flush can cancel it before it fires.
        const timer = setTimeout(() => {
          this.#retryTimers.delete(id);
          const latest = this.#unsaved.get(id);
          if (latest !== undefined) void this.#persistBody(id, latest, false);
        }, SAVE_RETRY_MS);
        this.#retryTimers.set(id, timer);
      } else {
        this.#failed = withSetEntry(this.#failed, id);
        this.#fail(e);
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

  /** Forget queued edits for notes that are being discarded. */
  #dropQueued(...ids: string[]): void {
    this.#unsaved = withoutMapKeys(this.#unsaved, ids);
    this.#failed = withoutSetEntries(this.#failed, ids);
    for (const id of ids) this.#clearRetryTimer(id);
  }

  /**
   * Undo for a soft delete: restore each id, then refresh. A note destroyed
   * in the meantime (or otherwise gone) fails quietly into a plain toast
   * instead of throwing back into the caller (the toast's action handler).
   */
  async #undoSoftDelete(ids: string[]): Promise<void> {
    const results = await Promise.allSettled(ids.map((id) => restoreNote(id)));
    await this.refresh();
    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount === 0) return;
    const message =
      failedCount === ids.length
        ? ids.length === 1
          ? "Couldn't restore. It may already be gone."
          : "Couldn't restore. The notes may already be gone."
        : `Couldn't restore ${failedCount} of ${ids.length} notes.`;
    toasts.show(message);
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
