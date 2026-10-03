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
  listStickies,
  listWorkspaceTags,
  popInNote,
  popOutNote,
  removeNoteFromWorkspace,
  removeTagFromNote,
  renameWorkspace,
  restoreNote,
  searchNotes,
  spaceSuggestions,
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
import { ERROR_CODES } from "$lib/api/error-codes";
import { EVENTS } from "$lib/api/events";
import { friendlyMessage, GENERIC_MESSAGE } from "$lib/errors";
import { isSyntheticNoteId, isSyntheticSpaceId } from "$lib/synthetic";
import {
  SaveQueue,
  type QueuedEdit,
  type SaveState,
} from "$lib/stores/library/save-queue.svelte";
import { SelectionModel } from "$lib/stores/library/selection.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { announceOverwrite } from "$lib/stores/agents.svelte";
import { mayHaveWritten, parseActivityLog, type AgentActivity } from "$lib/agent-activity";
import { boardFromText } from "$lib/whiteboard/excalidraw";
import { listen } from "@tauri-apps/api/event";

export type { SaveState };

// Archived and trash live behind a list filter in All Notes, not as
// top-level sections (two-section library: All Notes and Workspaces).
export type StatusFilter = "active" | "archived" | "trash";

// Debounce for search-text refreshes only, so a query runs per pause rather
// than per keystroke; filter clicks and change events stay immediate.
const SEARCH_DEBOUNCE_MS = 150;

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
  /** The Graph view: the library drawn as notes, tags, and Spaces. */
  graphMode = $state(false);
  revisitCount = $state(0);
  /** Unfiled notes the graph can say a Space for; the Graph row's count. */
  suggestionCount = $state(0);
  searchText = $state("");
  notes = $state<Note[]>([]);
  searchResults = $state<SearchResult[] | null>(null);
  tags = $state<TagWithCount[]>([]);
  workspaces = $state<WorkspaceWithCount[]>([]);
  selected = $state<Note | null>(null);
  selectedTags = $state<Tag[]>([]);
  selectedWorkspaces = $state<Workspace[]>([]);
  error = $state<string | null>(null);
  // Notes popped out as stickies. Each sticky is its note's only editor, so
  // the library stops editing a note the moment it appears here.
  stickyIds = $state<ReadonlySet<string>>(new Set());

  // Ids checked for bulk actions (the open note's id on a plain click; grows
  // via cmd-click / shift-click). Size > 1 swaps the editor for the bulk panel.
  // The set and its anchor/cursor live in a composed model; the store keeps the
  // open-note state and the editor-sync orchestration.
  #selection = new SelectionModel(() => this.visibleIds);
  get multiSelected(): ReadonlySet<string> {
    return this.#selection.ids;
  }

  // Edit persistence (debounce, retry, flush) lives in its own single-writer
  // unit; the store composes one and delegates. A confirmed write updates the
  // open note; a terminal failure surfaces an error.
  #saveQueue = new SaveQueue({
    onPersisted: async (id, updated) => {
      if (this.selected?.id === id) {
        // Keep the local body and canvas: the user may have kept editing
        // past this save, and the reply never carries the canvas.
        const { body, surfaceData } = this.selected;
        this.selected = { ...updated, body, surfaceData };
        this.selectedTags = await tagsForNote(id);
      }
      this.error = null;
    },
    onError: (e) => this.#fail(e),
    onOverwrote: (id, theirs) => announceOverwrite(id, () => this.#restoreExternal(id, theirs)),
  });

  // Editors that hold an edit not yet handed to the queue (a whiteboard
  // batches canvas changes before serializing them) register here, and are
  // asked to hand it over before any flush, trash, or note switch.
  #beforeFlush = new Set<() => void>();

  /** Register a hook run before every flush, trash, and note switch;
   *  returns the unregister function. */
  onBeforeFlush(hook: () => void): () => void {
    this.#beforeFlush.add(hook);
    return () => this.#beforeFlush.delete(hook);
  }

  #collectPending(): void {
    for (const hook of this.#beforeFlush) hook();
  }

  #initialized = false;

  #refreshDebounced = debounce(() => void this.refresh(), 50);
  // The revisit count rides the same 50ms window so a burst of change
  // events (bulk delete, undo) costs one count query, not one per event.
  #revisitCountDebounced = debounce(() => void this.#refreshRevisitCount(), 50);
  // The suggestion count too: every library change can change the evidence.
  #suggestionCountDebounced = debounce(() => void this.refreshSuggestionCount(), 50);
  #searchRefresh = debounce(() => void this.refresh(), SEARCH_DEBOUNCE_MS);

  /** Save status of the selected note, for the editor status bar. */
  get saveState(): SaveState {
    return this.#saveQueue.stateFor(this.selected?.id);
  }

  async init(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    // Listeners before the initial fetches: a change event arriving during
    // startup must trigger a re-query, not be dropped.
    await Promise.all([
      listen(EVENTS.NOTES_CHANGED, () => {
        this.#refreshDebounced();
        this.#revisitCountDebounced();
        this.#suggestionCountDebounced();
      }),
      listen(EVENTS.TAGS_CHANGED, () => {
        void this.refreshTags();
        this.#suggestionCountDebounced();
      }),
      listen(EVENTS.WORKSPACES_CHANGED, () => {
        void this.refreshWorkspaces();
        this.#suggestionCountDebounced();
      }),
      listen(EVENTS.STICKIES_CHANGED, () => void this.refreshStickies()),
      listen<unknown>(EVENTS.LIBRARY_EXTERNAL_CHANGE, (e) => {
        void this.#adoptExternal(parseActivityLog(e.payload));
      }),
    ]);
    await Promise.all([
      this.refresh(),
      this.refreshTags(),
      this.refreshWorkspaces(),
      this.#refreshRevisitCount(),
      this.refreshSuggestionCount(),
      this.refreshStickies(),
    ]);
  }

  // ---- stickies ----

  isSticky(id: string | undefined): boolean {
    return id !== undefined && this.stickyIds.has(id);
  }

  /** Re-read which notes are stickies. A note that just came back from one
   *  is reopened from disk if it is the open note: the sticky wrote it last. */
  async refreshStickies(): Promise<void> {
    try {
      const next = new Set(await listStickies());
      const returned = [...this.stickyIds].filter((id) => !next.has(id));
      this.stickyIds = next;
      const open = this.selected?.id;
      if (open && returned.includes(open)) await this.#open(open);
    } catch (e) {
      this.#fail(e);
    }
  }

  /**
   * Pop a note out as a sticky. Every pending edit is written first and the
   * note's must have landed: the sticky loads the note from disk, and an edit
   * still queued here would later overwrite whatever is typed there.
   */
  async popOut(id: string): Promise<void> {
    if (isSyntheticNoteId(id)) return;
    await this.flushPendingEdits();
    if (this.#saveQueue.peek(id) !== undefined) {
      toasts.show("Couldn't save this note, so it stays here for now.");
      return;
    }
    try {
      await popOutNote(id);
      await this.refreshStickies();
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Bring a sticky back into the library. Resolves once its edits are on
   *  disk and the open note shows them. */
  async popIn(id: string): Promise<void> {
    await this.#popInAll([id]);
  }

  /** The File menu's toggle: pop the open note out, or back in. */
  async toggleSticky(): Promise<void> {
    const note = this.selected;
    if (!note || note.isDeleted) return;
    await (this.isSticky(note.id) ? this.popIn(note.id) : this.popOut(note.id));
  }

  /** Pop in whichever of these notes are stickies, before anything that ends
   *  their life here (trash, destroy). False when a sticky could not save,
   *  in which case the caller must not go ahead. */
  async #popInAll(ids: string[]): Promise<boolean> {
    const stickies = ids.filter((id) => this.stickyIds.has(id));
    if (stickies.length === 0) return true;
    try {
      for (const id of stickies) await popInNote(id);
      return true;
    } catch (e) {
      this.#fail(e);
      return false;
    } finally {
      await this.refreshStickies();
    }
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

  // The open loops: capture-born notes nobody has opened, old enough to
  // resurface, oldest first. The store owns the rule (and the window) and
  // expands the flag, so the MCP tool's Revisit is the same list.
  #revisitFilter(): NoteFilter {
    return { revisit: true };
  }

  // Monotonic refresh token: queries answer out of order (search per pause,
  // list per filter click), so a response only lands while it is still the
  // newest request; a slow earlier reply can never clobber a later one.
  #refreshToken = 0;

  async refresh(): Promise<void> {
    const token = ++this.#refreshToken;
    // The update Space is synthetic: its two notes come from the updater, not
    // the store, so there is nothing to query. A search still runs globally,
    // which is why it is the one thing that takes precedence over the Space.
    if (isSyntheticSpaceId(this.activeWorkspaceId) && !this.searchText.trim()) {
      this.searchResults = null;
      this.notes = [];
      this.workspaceTags = [];
      this.error = null;
      return;
    }
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
    this.graphMode = false;
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
    this.graphMode = false;
    this.statusFilter = "active";
    this.searchText = "";
    this.clearMultiSelect();
  }

  /** Show the library as a graph. */
  selectGraph(): void {
    this.#resetForNavigation();
    this.graphMode = true;
    void this.refresh();
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

  /**
   * Re-count the suggestions (API.md section 4). Quiet like the revisit
   * count: it feeds a sidebar hint, and the next change event retries it.
   */
  async refreshSuggestionCount(): Promise<void> {
    try {
      this.suggestionCount = (await spaceSuggestions()).length;
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
      if (!(e instanceof ApiError && e.code === ERROR_CODES.NOT_FOUND))
        this.#fail(e);
    }
  }

  setSearch(text: string): void {
    this.searchText = text;
    // Reset the multi-selection but keep the open note in the editor.
    const openId = this.selected?.id ?? null;
    this.#selection.reset(openId ? [openId] : [], openId);
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
    // Opening a note shows it, wherever it was chosen from (the graph, the
    // palette), so the graph steps aside.
    this.graphMode = false;
    this.#selection.reset([id], id);
    await this.#open(id);
  }

  /**
   * Open one of the update Space's synthetic notes. It has no row in the store,
   * so there is nothing to fetch and nothing to persist; the pending edit of
   * the note being left is still flushed first, exactly as a real switch does.
   */
  selectVirtual(note: Note): void {
    this.graphMode = false;
    this.#collectPending();
    this.#saveQueue.flushDebounce();
    this.#selection.reset([note.id], note.id);
    this.selected = note;
    this.selectedTags = [];
    this.selectedWorkspaces = [];
    this.error = null;
  }

  async #open(id: string): Promise<void> {
    // Flush any pending edit of the previous note before switching.
    this.#collectPending();
    this.#saveQueue.flushDebounce();
    try {
      const note = await getNote(id, true);
      this.#saveQueue.known(note);
      // A queued edit (debounced or awaiting retry) is newer than what disk
      // returned; showing the disk body would fork the note's history.
      const queued = this.#saveQueue.peek(id);
      this.selected = queued !== undefined ? { ...note, ...queued } : note;
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
    this.#selection.toggle(id);
    await this.#syncEditorToSelection();
  }

  async extendSelectionTo(id: string): Promise<void> {
    this.#selection.extendTo(id);
    await this.#syncEditorToSelection();
  }

  async selectAllVisible(): Promise<void> {
    this.#selection.selectAll();
    await this.#syncEditorToSelection();
  }

  /**
   * Arrow-key movement; `extend` grows the range from the anchor.
   * Returns the id the selection moved to so the view can reveal it.
   */
  async moveSelection(delta: number, extend = false): Promise<string | null> {
    const next = this.#selection.step(delta, this.selected?.id ?? null);
    if (!next) return null;
    if (extend) {
      await this.extendSelectionTo(next);
    } else {
      await this.select(next);
    }
    return next;
  }

  clearMultiSelect(): void {
    this.#selection.clear();
    this.selected = null;
    this.selectedTags = [];
    this.selectedWorkspaces = [];
  }

  /** Keep the editor pane consistent with how many notes are checked. */
  async #syncEditorToSelection(): Promise<void> {
    const ids = [...this.multiSelected];
    if (ids.length === 1) {
      this.#selection.setActive(ids[0]);
      if (this.selected?.id !== ids[0]) await this.#open(ids[0]);
    } else {
      this.#saveQueue.flushDebounce();
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
    if (!(await this.#popInAll(ids))) return;
    // Trash is reversible and Undo promises fidelity: persist any pending
    // edit first, so a restored note holds the user's last keystrokes.
    this.#collectPending();
    this.#saveQueue.cancelDebounce();
    await this.#saveQueue.flushIds(ids);
    this.#saveQueue.drop(ids);
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
    if (!(await this.#popInAll(ids))) return;
    // Destroyed notes must also forget their queued edits, or the retry and
    // every later flush re-attempts a write against a row that no longer
    // exists and surfaces NOT_FOUND forever.
    this.#saveQueue.cancelDebounce();
    this.#saveQueue.drop(ids);
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
      this.#saveQueue.cancelDebounce();
      this.#saveQueue.drop(trashed.map((n) => n.id));
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

  /** Create a note and open it. Resolves to its id, or null if creating
   *  failed (the error is already surfaced). */
  async newNote(): Promise<string | null> {
    try {
      const activeTag = this.activeTagId
        ? this.tags.find((t) => t.id === this.activeTagId)
        : null;

      // A note cannot be born in the synthetic update Space; creating one there
      // drops the view back to All Notes rather than filing the note under a
      // workspace id that is not in the database.
      if (isSyntheticSpaceId(this.activeWorkspaceId)) {
        this.activeWorkspaceId = null;
      }

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
      return note.id;
    } catch (e) {
      this.#fail(e);
      return null;
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
          : GENERIC_MESSAGE;
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
    // A sticky is the note's only editor; see stickyIds.
    if (!this.selected || this.isSticky(this.selected.id)) return;
    // Optimistic local state; persistence is debounced. The note is dirty
    // from this moment until a write of this (or a newer) body succeeds.
    this.selected.body = body;
    // A synthetic note (the update Space's release notes) is not user data:
    // the edit lives while the note is open and is gone when it closes.
    if (isSyntheticNoteId(this.selected.id)) return;
    this.#saveQueue.queue(this.selected.id, { body });
  }

  /**
   * A whiteboard save: the canvas and the text written on it, queued like a
   * body edit (debounced, retried, flushed on switch and quit). Takes the id
   * because a board hands over its last change while the library is already
   * switching away from it.
   */
  editBoard(id: string, edit: Required<QueuedEdit>): void {
    if (this.isSticky(id)) return;
    if (this.selected?.id === id) {
      this.selected.surfaceData = edit.surfaceData;
      this.selected.body = edit.body;
    }
    this.#saveQueue.queue(id, edit);
  }

  /**
   * Turn the open note into a whiteboard, for good. Its text goes onto the
   * board as a text block, so nothing written disappears; the confirm lives
   * with the callers (whiteboard/convert.ts).
   */
  async convertToWhiteboard(): Promise<void> {
    const note = this.selected;
    if (!note || note.isDeleted || note.contentKind === "whiteboard") return;
    if (this.isSticky(note.id)) return;
    await this.flushPendingEdits();
    const current = this.selected;
    if (current?.id !== note.id) return;
    try {
      const surfaceData = await boardFromText(current.body);
      await this.#applyUpdate(note.id, { contentKind: "whiteboard", surfaceData });
    } catch (e) {
      this.#fail(e);
    }
  }

  /** A new note, opened as an empty whiteboard. Converts only the note it
   *  just created: if creating failed, the open note is someone's writing. */
  async newWhiteboard(): Promise<void> {
    const id = await this.newNote();
    if (id && this.selected?.id === id) await this.convertToWhiteboard();
  }

  editTitle(title: string): void {
    if (!this.selected || this.isSticky(this.selected.id)) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === this.selected.title) return;
    if (isSyntheticNoteId(this.selected.id)) {
      this.selected.title = trimmed;
      return;
    }
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
    if (!(await this.#popInAll([id]))) return;
    // Trash is reversible and Undo promises fidelity: persist any pending
    // edit first, so a restored note holds the user's last keystrokes.
    this.#collectPending();
    this.#saveQueue.cancelDebounce();
    await this.#saveQueue.flushIds([id]);
    this.#saveQueue.drop([id]);
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
   */
  async flushPendingEdits(): Promise<void> {
    this.#collectPending();
    await this.#saveQueue.flushAll();
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

  /**
   * Another process (an agent) wrote while a note is open. With nothing
   * unsaved, the open note takes the new version and the editor applies it
   * as a change under the caret. With unsaved typing it is left alone: that
   * save meets the other write through the version check (SaveQueue).
   */
  async #adoptExternal(entries: AgentActivity[]): Promise<void> {
    const open = this.selected;
    if (!open || isSyntheticNoteId(open.id) || open.contentKind === "whiteboard") return;
    if (!mayHaveWritten(entries, open.id)) return;
    const shown = open.body;
    // The user may have typed, or moved on, while this was read.
    const fresh = await this.#saveQueue.readExternal(
      open.id,
      () => this.selected?.id === open.id && this.selected.body === shown,
    );
    if (!fresh || !this.selected) return;
    this.selected = { ...fresh, surfaceData: this.selected.surfaceData };
    [this.selectedTags, this.selectedWorkspaces] = await Promise.all([
      tagsForNote(open.id),
      workspacesForNote(open.id),
    ]);
  }

  /** "Restore theirs": put an agent's overwritten body back, as an edit. */
  #restoreExternal(id: string, body: string): void {
    if (this.selected?.id === id) {
      this.selected.body = body;
      this.#saveQueue.queue(id, { body });
    } else {
      void this.#applyUpdate(id, { body });
    }
  }

  async #applyUpdate(
    id: string,
    patch: Parameters<typeof updateNote>[1],
  ): Promise<void> {
    try {
      const updated = await updateNote(id, patch);
      this.#saveQueue.known(updated);
      if (this.selected?.id === id) {
        // Keep local body if user kept typing past this save, and the local
        // canvas, which the reply never carries.
        const { body, surfaceData } = this.selected;
        this.selected = {
          ...updated,
          body: patch.body ?? body,
          surfaceData: patch.surfaceData ?? surfaceData,
        };
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
        : GENERIC_MESSAGE;
  }
}

export const library = new LibraryStore();
