import {
  addNoteToWorkspace,
  addTagToNote,
  ApiError,
  countNotes,
  createNote,
  deleteWorkspace,
  foldNotes,
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
  setTagColor,
  setWorkspaceColor,
  setWorkspaceFlag,
  destroyNotes as destroyNotesCmd,
  tagsForNote,
  undoFold,
  updateNote,
  workspaceTagSlices,
  workspacesForNote,
} from "$lib/api/client";
import type {
  FoldOutcome,
  Note,
  SearchResult,
  SpaceSuggestion,
  Tag,
  TagSlice,
  TagWithCount,
  Workspace,
  WorkspaceWithCount,
} from "$lib/api/types";
import { debounce } from "$lib/debounce";
import { ERROR_CODES } from "$lib/api/error-codes";
import { EVENTS, listen } from "$lib/api/events";
import { friendlyError, SAVE_CONFLICT_MESSAGE } from "$lib/errors";
import { isSyntheticNoteId, isSyntheticSpaceId } from "$lib/synthetic";
import {
  SaveQueue,
  type QueuedEdit,
  type SaveState,
} from "$lib/stores/library/save-queue.svelte";
import { SelectionModel } from "$lib/stores/library/selection.svelte";
import {
  NavigationModel,
  revisitFilter,
  type StatusFilter,
} from "$lib/stores/library/navigation.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { announceOverwrite } from "$lib/stores/agents.svelte";
import {
  mayHaveWritten,
  parseActivityLog,
  type AgentActivity,
  type NoteSnapshot,
} from "$lib/agent-activity";
import { parseVaultSynced } from "$lib/vault-mirror";
import { boardFromText } from "$lib/whiteboard/excalidraw";
import { appendRows, parseSheet, serializeSheet } from "$lib/sheet/model";
import { isWeb } from "$lib/api/runtime";
import { linkedNoteId } from "$lib/qr";
import { groupSlices } from "$lib/space-colors";

export type { StatusFilter } from "$lib/stores/library/navigation.svelte";

const SEARCH_DEBOUNCE_MS = 80;
const SUGGESTION_COUNT_DEBOUNCE_MS = 1500;
const LIST_BODY_CHARS = 512;
const LINKED_NOTE_WAIT_MS = 60_000;
const TAG_SLICES_DEBOUNCE_MS = 400;

class LibraryStore {
  nav = new NavigationModel();

  workspaceTags = $state<TagWithCount[]>([]);
  revisitCount = $state(0);
  suggestionCount = $state(0);
  suggestions = $state<SpaceSuggestion[]>([]);
  searchText = $state("");
  notes = $state<Note[]>([]);
  searchResults = $state<SearchResult[] | null>(null);
  tags = $state<TagWithCount[]>([]);
  workspaces = $state<WorkspaceWithCount[]>([]);
  tagSlices = $state<TagSlice[]>([]);
  slicesByWorkspace = $derived(groupSlices(this.tagSlices));
  selected = $state<Note | null>(null);
  focusRequest = $state<{ id: string; atEnd: boolean } | null>(null);
  selectedTags = $state<Tag[]>([]);
  selectedWorkspaces = $state<Workspace[]>([]);
  error = $state<string | null>(null);
  stickyIds = $state<ReadonlySet<string>>(new Set());

  #selection = new SelectionModel(() => this.visibleIds);
  get multiSelected(): ReadonlySet<string> {
    return this.#selection.ids;
  }

  #saveQueue = new SaveQueue({
    onPersisted: async (id, updated) => {
      if (this.selected?.id === id) {
        const { body, surfaceData, contentKind } = this.selected;
        this.selected = {
          ...updated,
          body: contentKind === "sheet" ? updated.body : body,
          surfaceData,
        };
        this.selectedTags = await tagsForNote(id);
      }
      this.error = null;
    },
    onError: (e) => this.#fail(e, SAVE_CONFLICT_MESSAGE),
    onOverwrote: (id, theirs) => announceOverwrite(id, () => this.#restoreExternal(id, theirs)),
    onMerged: (id, added) => this.#takeAppendedRows(id, added),
  });

  #beforeFlush = new Set<() => void>();

  onBeforeFlush(hook: () => void): () => void {
    this.#beforeFlush.add(hook);
    return () => this.#beforeFlush.delete(hook);
  }

  #collectPending(): void {
    for (const hook of this.#beforeFlush) hook();
  }

  #initialized = false;

  #refreshDebounced = debounce(() => void this.refresh(), 50);
  #revisitCountDebounced = debounce(() => void this.#refreshRevisitCount(), 50);
  #suggestionCountDebounced = debounce(
    () => void this.refreshSuggestionCount(),
    SUGGESTION_COUNT_DEBOUNCE_MS,
  );
  #tagSlicesDebounced = debounce(() => void this.refreshTagSlices(), TAG_SLICES_DEBOUNCE_MS);
  #searchRefresh = debounce(() => void this.refresh(), SEARCH_DEBOUNCE_MS);

  get saveState(): SaveState {
    return this.#saveQueue.stateFor(this.selected?.id);
  }

  async init(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    await Promise.all([
      listen(EVENTS.NOTES_CHANGED, () => {
        this.#refreshDebounced();
        this.#revisitCountDebounced();
        this.#suggestionCountDebounced();
        this.#tagSlicesDebounced();
      }),
      listen(EVENTS.TAGS_CHANGED, () => {
        void this.refreshTags();
        this.#tagSlicesDebounced();
        this.#suggestionCountDebounced();
      }),
      listen(EVENTS.WORKSPACES_CHANGED, () => {
        void this.refreshWorkspaces();
        this.#tagSlicesDebounced();
        this.#suggestionCountDebounced();
      }),
      listen(EVENTS.STICKIES_CHANGED, () => void this.refreshStickies()),
      listen<unknown>(EVENTS.LIBRARY_EXTERNAL_CHANGE, (e) => {
        void this.#adoptExternal(parseActivityLog(e.payload));
      }),
      listen<unknown>(EVENTS.VAULT_SYNCED, (e) => {
        const open = this.selected;
        if (open && parseVaultSynced(e.payload).includes(open.id)) void this.#adoptExternalNote(open);
      }),
    ]);
    await Promise.all([
      this.refresh(),
      this.refreshTags(),
      this.refreshWorkspaces(),
      this.refreshTagSlices(),
      this.#refreshRevisitCount(),
      this.refreshSuggestionCount(),
      this.refreshStickies(),
    ]);
  }

  isSticky(id: string | undefined): boolean {
    return id !== undefined && this.stickyIds.has(id);
  }

  async refreshStickies(): Promise<void> {
    if (isWeb) return;
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

  async popOut(id: string): Promise<void> {
    if (isSyntheticNoteId(id)) return;
    await this.flushPendingEdits();
    if (this.#saveQueue.peek(id) !== undefined) {
      toasts.show("Not saved, can't pop out");
      return;
    }
    try {
      await popOutNote(id);
      await this.refreshStickies();
    } catch (e) {
      this.#fail(e);
    }
  }

  async popIn(id: string): Promise<void> {
    await this.#popInAll([id]);
  }

  async toggleSticky(): Promise<void> {
    const note = this.selected;
    if (!note || note.isDeleted) return;
    await (this.isSticky(note.id) ? this.popIn(note.id) : this.popOut(note.id));
  }

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

  #refreshToken = 0;

  async refresh(): Promise<void> {
    const token = ++this.#refreshToken;
    if (isSyntheticSpaceId(this.nav.activeWorkspaceId) && !this.searchText.trim()) {
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
        const notes = await listNotes({ ...this.nav.filter(), bodyChars: LIST_BODY_CHARS });
        if (token !== this.#refreshToken) return;
        this.searchResults = null;
        this.notes = notes;
        const open = this.selected;
        const listed = open && notes.find((n) => n.id === open.id);
        if (open && listed && open.contentKind === "document" && listed.updatedAt > open.updatedAt) {
          void this.#adoptExternalNote(open);
        }
      }
      this.error = null;
      if (this.nav.revisitMode && !this.searchResults) {
        this.revisitCount = this.notes.length;
      }
      if (this.nav.activeWorkspaceId) {
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

  async refreshTagSlices(): Promise<void> {
    try {
      this.tagSlices = await workspaceTagSlices();
    } catch (e) {
      this.#fail(e);
    }
  }

  async colorTag(id: string, color: string | null): Promise<void> {
    try {
      await setTagColor(id, color);
      await Promise.all([this.refreshTags(), this.refreshTagSlices()]);
    } catch (e) {
      this.#fail(e);
    }
  }

  async colorWorkspace(id: string, color: string | null): Promise<void> {
    try {
      await setWorkspaceColor(id, color);
      await this.refreshWorkspaces();
    } catch (e) {
      this.#fail(e);
    }
  }

  async flagWorkspace(id: string, flag: boolean): Promise<void> {
    try {
      await setWorkspaceFlag(id, flag);
      await this.refreshWorkspaces();
    } catch (e) {
      this.#fail(e);
    }
  }

  async refreshWorkspaces(): Promise<void> {
    try {
      this.workspaces = await listWorkspaces();
      if (
        this.nav.activeWorkspaceId &&
        !this.workspaces.some((w) => w.id === this.nav.activeWorkspaceId)
      ) {
        this.selectWorkspace(null);
      }
    } catch (e) {
      this.#fail(e);
    }
  }

  setStatusFilter(filter: StatusFilter): void {
    this.#rememberOpen();
    this.nav.setStatus(filter);
    this.searchText = "";
    this.clearMultiSelect();
    void this.#enterView();
  }

  #leaveView(): void {
    this.#rememberOpen();
    this.#collectPending();
    this.#saveQueue.flushDebounce();
    this.workspaceTags = [];
    this.searchText = "";
    this.clearMultiSelect();
  }

  #openByView = new Map<string, string>();
  #carried: string | null = null;

  #rememberOpen(): void {
    const id = this.selected?.id;
    const open = id && !isSyntheticNoteId(id) && this.multiSelected.size <= 1 ? id : null;
    this.#carried = open;
    const key = this.nav.viewKey();
    if (!key) return;
    if (open) this.#openByView.set(key, open);
    else this.#openByView.delete(key);
  }

  async #enterView(): Promise<void> {
    const key = this.nav.viewKey();
    await this.refresh();
    if (!key || key !== this.nav.viewKey()) return;
    if (this.selected || this.multiSelected.size > 0) return;
    const id = [this.#carried, this.#openByView.get(key)].find(
      (c) => c && this.notes.some((n) => n.id === c),
    );
    if (id) await this.select(id);
  }

  selectGraph(): void {
    this.#leaveView();
    this.nav.showGraph();
    void this.refresh();
  }

  selectWorkspace(workspaceId: string | null): void {
    this.#leaveView();
    this.nav.showWorkspace(workspaceId);
    void this.#enterView();
  }

  selectRevisit(): void {
    this.#leaveView();
    this.nav.showRevisit();
    void this.#enterView();
  }

  setTagFilter(tagId: string | null): void {
    this.#leaveView();
    this.nav.showTag(tagId);
    void this.#enterView();
  }

  async #refreshRevisitCount(): Promise<void> {
    try {
      this.revisitCount = await countNotes(revisitFilter());
    } catch {
    }
  }

  async refreshSuggestionCount(): Promise<void> {
    try {
      this.suggestions = await spaceSuggestions();
      this.suggestionCount = this.suggestions.length;
    } catch {
    }
  }

  toggleScopedTag(tagId: string): void {
    this.#rememberOpen();
    if (!this.nav.toggleScopedTag(tagId)) return;
    this.clearMultiSelect();
    void this.#enterView();
  }

  async #refreshWorkspaceTags(): Promise<void> {
    const id = this.nav.activeWorkspaceId;
    if (!id) {
      this.workspaceTags = [];
      return;
    }
    try {
      const tags = await listWorkspaceTags(id);
      if (this.nav.activeWorkspaceId !== id) return;
      this.workspaceTags = tags;
      if (this.nav.scopedTagId && !tags.some((t) => t.id === this.nav.scopedTagId)) {
        this.nav.scopedTagId = null;
        void this.refresh();
      }
    } catch (e) {
      if (this.nav.activeWorkspaceId !== id) return;
      this.workspaceTags = [];
      if (!(e instanceof ApiError && e.code === ERROR_CODES.NOT_FOUND))
        this.#fail(e);
    }
  }

  setSearch(text: string): void {
    this.searchText = text;
    const openId = this.selected?.id ?? null;
    this.#selection.reset(openId ? [openId] : [], openId);
    if (text.trim()) {
      this.#searchRefresh();
    } else {
      this.#searchRefresh.cancel();
      void this.refresh();
    }
  }

  async searchNow(): Promise<void> {
    this.#searchRefresh.cancel();
    await this.refresh();
  }

  async write(id: string): Promise<void> {
    if (this.selected?.id !== id) await this.select(id);
    if (this.selected?.id === id) this.focusRequest = { id, atEnd: false };
  }

  async openLinked(hash: string): Promise<void> {
    const id = linkedNoteId(hash);
    if (!id) return;
    const present = async () => {
      try {
        await getNote(id, false);
        return true;
      } catch {
        return false;
      }
    };
    if (await present()) {
      await this.select(id);
      return;
    }
    const found = await new Promise<boolean>((resolve) => {
      let checking = false;
      let settled = false;
      let unlisten: (() => void) | null = null;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unlisten?.();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), LINKED_NOTE_WAIT_MS);
      void listen(EVENTS.NOTES_CHANGED, async () => {
        if (checking) return;
        checking = true;
        if (await present()) done(true);
        checking = false;
      }).then((off) => {
        if (settled) off();
        else unlisten = off;
      });
    });
    if (found) await this.select(id);
    else toasts.show("Note not on this device yet");
  }

  async select(id: string): Promise<void> {
    this.nav.graphMode = false;
    this.#selection.reset([id], id);
    await this.#open(id);
  }

  selectVirtual(note: Note): void {
    this.nav.graphMode = false;
    this.#collectPending();
    this.#saveQueue.flushDebounce();
    this.#selection.reset([note.id], note.id);
    this.selected = note;
    this.selectedTags = [];
    this.selectedWorkspaces = [];
    this.error = null;
  }

  async #open(id: string): Promise<void> {
    this.#collectPending();
    this.#saveQueue.flushDebounce();
    try {
      const [note, tags, workspaces] = await Promise.all([
        getNote(id, true),
        tagsForNote(id),
        workspacesForNote(id),
      ]);
      this.#saveQueue.known(note);
      const queued = this.#saveQueue.peek(id);
      this.selected = queued !== undefined ? { ...note, ...queued } : note;
      this.selectedTags = tags;
      this.selectedWorkspaces = workspaces;
      this.error = null;
      void this.#refreshRevisitCount();
      if (this.nav.revisitMode) void this.refresh();
    } catch (e) {
      this.#fail(e);
    }
  }

  get visibleIds(): string[] {
    return this.searchResults
      ? this.searchResults.map((h) => h.noteId)
      : this.notes.map((n) => n.id);
  }

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

  get canBulkFold(): boolean {
    if (this.nav.statusFilter === "trash" || this.multiSelected.size < 2) return false;
    return this.canFoldIds([...this.multiSelected]);
  }

  canFoldIds(ids: string[]): boolean {
    if (this.nav.statusFilter === "trash") return false;
    const real = ids.filter((id) => !isSyntheticNoteId(id));
    if (real.length < 2) return false;
    return this.notes
      .filter((n) => real.includes(n.id))
      .every((n) => !n.isDeleted && n.contentKind === "document");
  }

  async bulkFold(): Promise<void> {
    const ordered = this.visibleIds.filter((id) => this.multiSelected.has(id));
    const rest = [...this.multiSelected].filter((id) => !ordered.includes(id));
    await this.foldIds([...ordered, ...rest]);
  }

  async foldIds(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)].filter((id) => !isSyntheticNoteId(id));
    if (unique.length < 2) return;
    const docIds: string[] = [];
    for (const id of unique) {
      const cached = this.notes.find((n) => n.id === id);
      const note = cached ?? (await getNote(id, false).catch(() => null));
      if (!note || note.isDeleted || note.contentKind !== "document") {
        toasts.show("Text notes only");
        return;
      }
      docIds.push(id);
    }
    const [targetId, ...sourceIds] = docIds;
    if (!targetId || sourceIds.length === 0) return;
    await this.#fold(
      unique,
      targetId,
      sourceIds,
      async () => {
        await Promise.all([
          this.refresh(),
          this.refreshTags(),
          this.refreshWorkspaces(),
          this.#refreshRevisitCount(),
        ]);
        await this.select(targetId);
      },
      (outcome) => {
        const n = outcome.foldedIds.length;
        return `Folded ${n} ${n === 1 ? "note" : "notes"} into “${outcome.note.title || "Untitled"}”`;
      },
    );
  }

  async #fold(
    allIds: string[],
    targetId: string,
    sourceIds: string[],
    settle: (outcome: FoldOutcome) => Promise<void>,
    message: (outcome: FoldOutcome) => string,
  ): Promise<boolean> {
    if (!(await this.#popInAll(allIds))) return false;
    this.#collectPending();
    this.#saveQueue.cancelDebounce();
    await this.#saveQueue.flushIds(allIds);
    if (this.#saveQueue.peek(targetId) !== undefined) return false;
    this.#saveQueue.drop(sourceIds);
    try {
      const outcome = await foldNotes(targetId, sourceIds);
      this.#saveQueue.known(outcome.note);
      this.error = null;
      await settle(outcome);
      toasts.show(message(outcome), {
        label: "Undo",
        run: () => void this.#undoFold(outcome.before),
      });
      return true;
    } catch (e) {
      this.#fail(e);
      return false;
    }
  }

  async foldIntoSelected(sourceId: string, sourceTitle?: string): Promise<boolean> {
    const target = this.selected;
    if (
      !target ||
      target.isDeleted ||
      target.contentKind !== "document" ||
      isSyntheticNoteId(target.id) ||
      isSyntheticNoteId(sourceId) ||
      target.id === sourceId
    ) {
      return false;
    }
    return this.#fold(
      [target.id, sourceId],
      target.id,
      [sourceId],
      async (outcome) => {
        if (this.selected?.id === outcome.note.id) {
          this.selected = outcome.note;
          [this.selectedTags, this.selectedWorkspaces] = await Promise.all([
            tagsForNote(outcome.note.id),
            workspacesForNote(outcome.note.id),
          ]);
        }
        void this.refresh();
        void this.refreshTags();
        void this.refreshWorkspaces();
        void this.#refreshRevisitCount();
      },
      () => `Folded “${sourceTitle || "Untitled"}” into this note`,
    );
  }

  async #undoFold(before: NoteSnapshot[]): Promise<void> {
    if (before.length === 0) return;
    const targetId = before[0].id;
    this.#collectPending();
    this.#saveQueue.cancelDebounce();
    await this.#saveQueue.flushIds([targetId]);
    this.#saveQueue.drop([targetId]);
    try {
      const restored = await undoFold(before);
      this.#saveQueue.known(restored);
      await Promise.all([
        this.refresh(),
        this.refreshTags(),
        this.refreshWorkspaces(),
        this.#refreshRevisitCount(),
      ]);
      if (this.selected?.id === restored.id) await this.#open(restored.id);
    } catch {
      toasts.show("Couldn't undo fold");
    }
  }

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
    await this.restoreIds([...this.multiSelected]);
  }

  async restoreIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await restoreNotes(ids);
      this.error = null;
    } catch (e) {
      this.#fail(e);
      return;
    }
    if (ids.some((id) => this.multiSelected.has(id) || this.selected?.id === id)) {
      this.clearMultiSelect();
    }
  }

  async bulkDestroy(): Promise<void> {
    await this.destroyNotes([...this.multiSelected]);
  }

  async destroyNotes(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    if (!(await this.#popInAll(ids))) return;
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

  async newNote(body?: string): Promise<string | null> {
    try {
      const activeTag = this.nav.activeTagId
        ? this.tags.find((t) => t.id === this.nav.activeTagId)
        : null;

      if (isSyntheticSpaceId(this.nav.activeWorkspaceId)) {
        this.nav.activeWorkspaceId = null;
      }

      const note = await createNote({
        ...(activeTag ? { tags: [activeTag.name] } : {}),
        ...(body ? { body } : {}),
      });
      if (this.nav.activeWorkspaceId) {
        await addNoteToWorkspace(note.id, this.nav.activeWorkspaceId);
      }
      this.nav.statusFilter = "active";
      this.nav.revisitMode = false;
      if (!activeTag) this.nav.activeTagId = null;
      this.searchText = "";
      void this.refresh();
      await this.select(note.id);
      if (this.selected?.id === note.id) this.focusRequest = { id: note.id, atEnd: true };
      return note.id;
    } catch (e) {
      this.#fail(e);
      return null;
    }
  }

  async createWorkspace(name: string): Promise<void> {
    if (!name.trim()) return;
    try {
      const ws = await getOrCreateWorkspace(name);
      this.selectWorkspace(ws.id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async removeWorkspace(id: string): Promise<void> {
    const ws = this.workspaces.find((w) => w.id === id);
    try {
      const memberIds = await deleteWorkspace(id);
      if (this.nav.activeWorkspaceId === id) this.selectWorkspace(null);
      if (this.selected) {
        this.selectedWorkspaces = await workspacesForNote(this.selected.id);
      }
      await this.refreshWorkspaces();
      if (ws) {
        toasts.show(`Deleted "${ws.name}"`, {
          label: "Undo",
          run: () => void this.#undoWorkspaceDelete(ws.name, memberIds),
        });
      }
    } catch (e) {
      this.#fail(e);
    }
  }

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
          `Restored "${name}", ${failedCount} of ${memberIds.length} notes missing`,
        );
      }
    } catch {
      toasts.show(`Couldn't restore "${name}"`);
    }
  }

  async renameWorkspace(
    id: string,
    name: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await renameWorkspace(id, name);
      await this.refreshWorkspaces();
      if (this.selected) {
        this.selectedWorkspaces = await workspacesForNote(this.selected.id);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyError(e) };
    }
  }

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
    if (!this.selected || this.isSticky(this.selected.id)) return;
    this.selected.body = body;
    if (isSyntheticNoteId(this.selected.id)) return;
    this.#saveQueue.queue(this.selected.id, { body });
  }

  editBoard(id: string, edit: Required<QueuedEdit>): void {
    if (this.isSticky(id)) return;
    if (this.selected?.id === id) {
      this.selected.surfaceData = edit.surfaceData;
      this.selected.body = edit.body;
    }
    this.#saveQueue.queue(id, edit);
  }

  editSheet(id: string, surfaceData: string): void {
    if (this.isSticky(id)) return;
    if (this.selected?.id === id) this.selected.surfaceData = surfaceData;
    this.#saveQueue.queue(id, { surfaceData });
  }

  #takeAppendedRows(id: string, added: string[][]): void {
    if (this.selected?.id !== id || added.length === 0) return;
    const surfaceData = serializeSheet(appendRows(parseSheet(this.selected.surfaceData), added));
    this.selected.surfaceData = surfaceData;
    if (this.#saveQueue.peek(id) !== undefined) this.#saveQueue.queue(id, { surfaceData });
  }

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

  async newWhiteboard(): Promise<void> {
    const id = await this.newNote();
    if (id && this.selected?.id === id) await this.convertToWhiteboard();
  }

  async newSheet(): Promise<void> {
    const id = await this.newNote();
    if (id && this.selected?.id === id) await this.#convertToSheet();
  }

  async #convertToSheet(): Promise<void> {
    const note = this.selected;
    if (!note || note.isDeleted || note.contentKind !== "document") return;
    if (this.isSticky(note.id)) return;
    await this.flushPendingEdits();
    if (this.selected?.id !== note.id) return;
    await this.#applyUpdate(note.id, { contentKind: "sheet" });
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

  async flushPendingEdits(): Promise<void> {
    this.#collectPending();
    await this.#saveQueue.flushAll();
  }

  async #undoSoftDelete(ids: string[]): Promise<void> {
    const results = await Promise.allSettled(ids.map((id) => restoreNote(id)));
    await this.refresh();
    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount === 0) return;
    toasts.show(
      failedCount === ids.length
        ? "Couldn't restore"
        : `Couldn't restore ${failedCount} of ${ids.length} notes`,
    );
  }

  async #adoptExternal(entries: AgentActivity[]): Promise<void> {
    const open = this.selected;
    if (open && mayHaveWritten(entries, open.id)) await this.#adoptExternalNote(open);
  }

  async #adoptExternalNote(open: Note): Promise<void> {
    if (isSyntheticNoteId(open.id) || open.contentKind === "whiteboard") return;
    if (open.contentKind === "sheet") return this.#adoptExternalSheet(open.id);
    const shown = open.body;
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

  async #adoptExternalSheet(id: string): Promise<void> {
    const taken = await this.#saveQueue.readExternalSheet(id, () => this.selected?.id === id);
    if (!taken || this.selected?.id !== id) return;
    this.selected = { ...taken.note, surfaceData: taken.surfaceData };
    [this.selectedTags, this.selectedWorkspaces] = await Promise.all([
      tagsForNote(id),
      workspacesForNote(id),
    ]);
  }

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
        const { body, surfaceData } = this.selected;
        this.selected = {
          ...updated,
          body: updated.contentKind === "sheet" ? updated.body : (patch.body ?? body),
          surfaceData: patch.surfaceData ?? surfaceData,
        };
        this.selectedTags = await tagsForNote(id);
      }
      this.error = null;
    } catch (e) {
      this.#fail(e);
    }
  }

  #fail(e: unknown, conflict?: string): void {
    this.error = friendlyError(e, conflict);
  }
}

export const library = new LibraryStore();
