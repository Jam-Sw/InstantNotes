// Save queue, race token, and quit-flush tests for the library store. These
// behaviors shipped untested (July 2026 frontend audit) and each test below
// is built to fail if the guarded behavior regresses.
//
// $lib/api/client and @tauri-apps/api/event are mocked; timers are fake
// throughout so debounce/retry timing is deterministic. Because `library` is
// a module-level singleton, every test loads a fresh copy of the module via
// vi.resetModules() + dynamic import so state never bleeds between tests.
// (vi.mock's factory itself is not re-run by resetModules, so the imported
// mock functions below keep stable identity across the whole file; only the
// store's own module -- and therefore its state -- is fresh per test.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNoteToWorkspace,
  ApiError,
  createNote,
  deleteWorkspace,
  destroyNotes,
  getNote,
  getOrCreateWorkspace,
  listNotes,
  listTags,
  listWorkspaces,
  listWorkspaceTags,
  permanentlyDeleteNote,
  renameWorkspace,
  searchNotes,
  softDeleteNote,
  softDeleteNotes,
  tagsForNote,
  updateNote,
  workspacesForNote,
} from "$lib/api/client";
import { listen } from "@tauri-apps/api/event";
import type {
  Note,
  SearchResult,
  TagWithCount,
  WorkspaceWithCount,
} from "$lib/api/types";

vi.mock("$lib/api/client", () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.code = code;
    }
  }
  return {
    ApiError,
    createNote: vi.fn(),
    getNote: vi.fn(),
    updateNote: vi.fn(),
    softDeleteNote: vi.fn(),
    softDeleteNotes: vi.fn(),
    restoreNote: vi.fn(),
    restoreNotes: vi.fn(),
    setNotesFlags: vi.fn(),
    permanentlyDeleteNote: vi.fn(),
    destroyNotes: vi.fn(),
    listNotes: vi.fn(),
    searchNotes: vi.fn(),
    listTags: vi.fn(),
    listWorkspaces: vi.fn(),
    getOrCreateWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    listWorkspaceTags: vi.fn(),
    addNoteToWorkspace: vi.fn(),
    removeNoteFromWorkspace: vi.fn(),
    workspacesForNote: vi.fn(),
    addTagToNote: vi.fn(),
    removeTagFromNote: vi.fn(),
    tagsForNote: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const mockCreateNote = vi.mocked(createNote);
const mockGetNote = vi.mocked(getNote);
const mockUpdateNote = vi.mocked(updateNote);
const mockListNotes = vi.mocked(listNotes);
const mockSearchNotes = vi.mocked(searchNotes);
const mockListTags = vi.mocked(listTags);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockTagsForNote = vi.mocked(tagsForNote);
const mockWorkspacesForNote = vi.mocked(workspacesForNote);
const mockPermanentlyDeleteNote = vi.mocked(permanentlyDeleteNote);
const mockDestroyNotes = vi.mocked(destroyNotes);
const mockSoftDeleteNote = vi.mocked(softDeleteNote);
const mockSoftDeleteNotes = vi.mocked(softDeleteNotes);
const mockDeleteWorkspace = vi.mocked(deleteWorkspace);
const mockRenameWorkspace = vi.mocked(renameWorkspace);
const mockGetOrCreateWorkspace = vi.mocked(getOrCreateWorkspace);
const mockAddNoteToWorkspace = vi.mocked(addNoteToWorkspace);
const mockListWorkspaceTags = vi.mocked(listWorkspaceTags);
const mockListen = vi.mocked(listen);

function mkNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Note ${id}`,
    body: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document",
    surfaceData: null,
    ...overrides,
  };
}

function mkSearchResult(id: string): SearchResult {
  return {
    noteId: id,
    title: `Note ${id}`,
    excerpt: "",
    score: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** A promise plus its resolve/reject, so races can be driven by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fresh module graph so the singleton store instance starts clean. */
async function load() {
  const mod = await import("$lib/stores/library.svelte");
  return mod.library;
}

async function selectNote(
  library: Awaited<ReturnType<typeof load>>,
  id: string,
  overrides: Partial<Note> = {},
) {
  mockGetNote.mockResolvedValueOnce(mkNote(id, overrides));
  await library.select(id);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();

  mockCreateNote.mockReset();
  mockGetNote.mockReset();
  mockUpdateNote.mockReset();
  mockListNotes.mockReset().mockResolvedValue([]);
  mockSearchNotes.mockReset().mockResolvedValue([]);
  mockListTags.mockReset().mockResolvedValue([]);
  mockListWorkspaces.mockReset().mockResolvedValue([]);
  mockTagsForNote.mockReset().mockResolvedValue([]);
  mockWorkspacesForNote.mockReset().mockResolvedValue([]);
  mockPermanentlyDeleteNote.mockReset();
  mockDestroyNotes.mockReset();
  mockDestroyNotes.mockResolvedValue(undefined);
  mockSoftDeleteNote.mockReset();
  mockSoftDeleteNotes.mockReset();
  mockSoftDeleteNotes.mockResolvedValue(undefined);
  mockDeleteWorkspace.mockReset();
  mockRenameWorkspace.mockReset();
  mockGetOrCreateWorkspace.mockReset();
  mockAddNoteToWorkspace.mockReset();
  mockListWorkspaceTags.mockReset().mockResolvedValue([]);
  mockListen.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("save queue", () => {
  it("queues the edit and reports saving until the debounced write settles", async () => {
    const library = await load();
    await selectNote(library, "n1");

    const write = deferred<Note>();
    mockUpdateNote.mockReturnValueOnce(write.promise);

    library.editBody("new body");
    // #unsaved is set synchronously in editBody, before the debounce fires.
    expect(library.saveState).toBe("saving");
    expect(mockUpdateNote).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", { body: "new body" });
    // Write still in flight: must not claim "saved" over unpersisted data.
    expect(library.saveState).toBe("saving");

    write.resolve(mkNote("n1", { body: "new body" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(library.saveState).toBe("saved");
  });

  it("retries once after ~2s and clears saving/failed state on a successful retry", async () => {
    const library = await load();
    await selectNote(library, "n1");

    mockUpdateNote
      .mockRejectedValueOnce(new ApiError("STORAGE_ERROR", "locked"))
      .mockResolvedValueOnce(mkNote("n1", { body: "retry body" }));

    library.editBody("retry body");
    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    // First failure alone must not surface as "failed" -- it's still
    // waiting out the retry backoff.
    expect(library.saveState).toBe("saving");
    expect(library.error).toBeNull();

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(2);
    expect(library.saveState).toBe("saved");
  });

  it("moves the note to failed after a second consecutive failure", async () => {
    const library = await load();
    await selectNote(library, "n1");

    mockUpdateNote.mockRejectedValue(
      new ApiError("STORAGE_ERROR", "disk full"),
    );

    library.editBody("doomed");
    await vi.advanceTimersByTimeAsync(400);
    expect(library.saveState).toBe("saving");
    expect(library.error).toBeNull();

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(2);
    expect(library.saveState).toBe("failed");
    expect(library.error).toBe(
      "Your note couldn't be saved. Please try again.",
    );
  });
});

describe("flushPendingEdits", () => {
  it("flushes the debounce immediately, without waiting for the 400ms window", async () => {
    const library = await load();
    await selectNote(library, "n1");

    const write = deferred<Note>();
    mockUpdateNote.mockReturnValueOnce(write.promise);

    library.editBody("flush me");
    const flushed = library.flushPendingEdits();
    // The write must fire synchronously off the flush, not off the timer.
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", { body: "flush me" });

    write.resolve(mkNote("n1", { body: "flush me" }));
    await flushed;

    expect(library.saveState).toBe("saved");
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed note in #failed rather than dropping the edit", async () => {
    const library = await load();
    await selectNote(library, "n1");

    mockUpdateNote.mockRejectedValue(new ApiError("STORAGE_ERROR", "locked"));

    library.editBody("will fail");
    await library.flushPendingEdits();

    // Queued edit survives the failure: saveState is "failed", not "saved",
    // and a later flush would still have something to retry (proven by the
    // note staying selected/dirty rather than the state resetting to idle).
    expect(library.saveState).toBe("failed");
    expect(library.error).toBe(
      "Your note couldn't be saved. Please try again.",
    );
  });

  it("fixed: a flush of one dirty note performs exactly one write attempt, and no timer survives once it resolves", async () => {
    // flushPendingEdits used to call #saveBody.flush(), which ran the
    // retry-enabled callback (canRetry=true) and scheduled a hidden 2s
    // setTimeout retry on failure, *in addition to* flushPendingEdits' own
    // explicit no-retry re-attempt -- two immediate writes plus a stray
    // third write after the flush had already resolved. flushPendingEdits
    // now cancels the debounce outright and performs its own single
    // no-retry persist, so a failing flush writes exactly once and leaves
    // no retry timer behind.
    const library = await load();
    await selectNote(library, "n1");

    mockUpdateNote.mockRejectedValue(new ApiError("STORAGE_ERROR", "locked"));

    library.editBody("stray retry");
    await library.flushPendingEdits();
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    expect(library.saveState).toBe("failed");

    // No retry timer was scheduled by the no-retry flush path, so nothing
    // fires after the old 2s retry window elapses.
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });
});

describe("destroy paths drop queued edits (regression: fixed 2026-07-08)", () => {
  it("bulkDestroy cancels the pending debounce so no write is ever attempted", async () => {
    const library = await load();
    await selectNote(library, "n1");

    library.editBody("about to be destroyed");
    await library.bulkDestroy();

    // Past debounce (400ms) and past the retry window (2000ms): if the
    // queued edit were not dropped, updateNote would fire here.
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(mockDestroyNotes).toHaveBeenCalledWith(["n1"], true);
  });

  it("emptyTrash cancels queued edits for every trashed note before destroying them", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockListNotes.mockResolvedValueOnce([mkNote("n1"), mkNote("n2")]);

    library.editBody("in the trash");
    await library.emptyTrash();

    await vi.advanceTimersByTimeAsync(3000);

    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(mockDestroyNotes).toHaveBeenCalledWith(["n1", "n2"], true);
  });

  it("destroySelected cancels the open note's queued edit", async () => {
    const library = await load();
    await selectNote(library, "n1");

    library.editBody("open note, about to be destroyed");
    await library.destroySelected();

    await vi.advanceTimersByTimeAsync(3000);

    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(mockDestroyNotes).toHaveBeenCalledWith(["n1"], true);
  });

  it("control: without a destroy, the same queued edit does reach updateNote", async () => {
    // Sanity check for the three tests above: proves the fake-timer harness
    // really does drive the debounce through to a write when nothing
    // intervenes, so "updateNote not called" above is a meaningful signal
    // and not an artifact of timers never firing.
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockResolvedValue(mkNote("n1", { body: "kept" }));

    library.editBody("kept");
    await vi.advanceTimersByTimeAsync(400);

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", { body: "kept" });
  });
});

describe("soft delete flushes queued edits (Undo restores the last keystrokes)", () => {
  it("deleteSelected persists the pending edit before trashing the note", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockResolvedValue(mkNote("n1", { body: "last keystrokes" }));
    mockSoftDeleteNote.mockResolvedValue(mkNote("n1", { isDeleted: true }));

    library.editBody("last keystrokes");
    await library.deleteSelected();

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "last keystrokes",
    });
    expect(mockSoftDeleteNote).toHaveBeenCalledWith("n1");
    // The write must land before the trash, or a restore loses the edit.
    const write = mockUpdateNote.mock.invocationCallOrder[0];
    const trash = mockSoftDeleteNote.mock.invocationCallOrder[0];
    expect(write).toBeLessThan(trash);
    // Nothing further fires later: no leftover debounce, no retry timer.
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });

  it("bulkDelete persists pending edits for the selection before trashing", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockResolvedValue(
      mkNote("n1", { body: "unsaved bulk edit" }),
    );
    mockSoftDeleteNotes.mockResolvedValue(undefined);

    library.editBody("unsaved bulk edit");
    await library.bulkDelete();

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "unsaved bulk edit",
    });
    expect(mockSoftDeleteNotes).toHaveBeenCalledWith(["n1"]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });

  it("a failed pre-trash flush still trashes the note and surfaces the error", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockRejectedValue(
      new ApiError("STORAGE_ERROR", "disk full"),
    );
    mockSoftDeleteNote.mockResolvedValue(mkNote("n1", { isDeleted: true }));

    library.editBody("doomed edit");
    await library.deleteSelected();

    expect(mockSoftDeleteNote).toHaveBeenCalledWith("n1");
    expect(library.error).toBeTruthy();
    // The failed edit is dropped with the trashed note; no retry fires later.
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });
});

describe("refresh race token", () => {
  it("a slow older list refresh cannot clobber a newer one", async () => {
    const library = await load();
    const older = deferred<Note[]>();
    const newer = deferred<Note[]>();
    mockListNotes
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const p1 = library.refresh();
    const p2 = library.refresh();

    newer.resolve([mkNote("newer")]);
    await p2;
    expect(library.notes.map((n) => n.id)).toEqual(["newer"]);

    older.resolve([mkNote("older")]);
    await p1;
    // The stale response must be discarded, not applied after the fact.
    expect(library.notes.map((n) => n.id)).toEqual(["newer"]);
  });

  it("a slow older search refresh cannot clobber a newer one", async () => {
    const library = await load();
    library.setSearch("q");
    await vi.advanceTimersByTimeAsync(0); // let the immediate search-text set land; refresh below is called directly

    const older = deferred<SearchResult[]>();
    const newer = deferred<SearchResult[]>();
    mockSearchNotes
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const p1 = library.refresh();
    const p2 = library.refresh();

    newer.resolve([mkSearchResult("newer")]);
    await p2;
    expect(library.searchResults?.map((r) => r.noteId)).toEqual(["newer"]);

    older.resolve([mkSearchResult("older")]);
    await p1;
    expect(library.searchResults?.map((r) => r.noteId)).toEqual(["newer"]);
  });
});

describe("search debounce", () => {
  it("collapses rapid setSearch calls into a single query for the final text", async () => {
    const library = await load();

    library.setSearch("a");
    await vi.advanceTimersByTimeAsync(50);
    library.setSearch("ab");
    await vi.advanceTimersByTimeAsync(50);
    library.setSearch("abc");
    expect(mockSearchNotes).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(mockSearchNotes).toHaveBeenCalledTimes(1);
    expect(mockSearchNotes).toHaveBeenCalledWith("abc");
  });

  it("clearing the search text cancels the debounce and refreshes immediately", async () => {
    const library = await load();

    library.setSearch("something");
    expect(mockSearchNotes).not.toHaveBeenCalled();

    library.setSearch("");
    // Immediate: listNotes fires synchronously off the clear, not gated by
    // the 150ms debounce.
    expect(mockListNotes).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    // The canceled debounce must never fire the stale query.
    expect(mockSearchNotes).not.toHaveBeenCalled();
  });
});

describe("init ordering", () => {
  it("registers listeners before the first fetch and waits for them to resolve", async () => {
    const library = await load();
    const gate = deferred<() => void>();
    mockListen.mockImplementation(() => gate.promise);

    const initPromise = library.init();

    expect(mockListen.mock.calls.map((c) => c[0])).toEqual([
      "notes:changed",
      "tags:changed",
      "workspaces:changed",
    ]);
    expect(mockListNotes).not.toHaveBeenCalled();
    expect(mockListTags).not.toHaveBeenCalled();
    expect(mockListWorkspaces).not.toHaveBeenCalled();

    gate.resolve(() => {});
    await initPromise;

    // Two listNotes calls: the visible list and the revisit count.
    expect(mockListNotes).toHaveBeenCalledTimes(2);
    expect(mockListTags).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("guards against double invocation: a second concurrent call does no extra work", async () => {
    const library = await load();

    const p1 = library.init();
    const p2 = library.init();
    await Promise.all([p1, p2]);

    expect(mockListen).toHaveBeenCalledTimes(3);
    // Two listNotes calls: the visible list and the revisit count.
    expect(mockListNotes).toHaveBeenCalledTimes(2);
    expect(mockListTags).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("wires the notes:changed listener to a debounced refresh", async () => {
    const library = await load();
    await library.init();
    mockListNotes.mockClear();

    const handler = mockListen.mock.calls.find(
      (c) => c[0] === "notes:changed",
    )?.[1] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    handler!();

    expect(mockListNotes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    // The debounce window releases both the list and the revisit count.
    expect(mockListNotes).toHaveBeenCalledTimes(2);
  });
});

// ---- Spaces rework: scoped tag chips + undo-able workspace delete ----

function mkTagWithCount(id: string, name: string): TagWithCount {
  return {
    id,
    name,
    color: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    usageCount: 1,
  };
}

function mkWorkspace(id: string, name: string): WorkspaceWithCount {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    noteCount: 0,
  };
}

describe("scoped tag filter (chips inside a workspace)", () => {
  it("composes with the workspace filter, toggles off, and resets on switch", async () => {
    const library = await load();
    mockListWorkspaceTags.mockResolvedValue([
      mkTagWithCount("t-school", "school"),
    ]);

    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockListNotes).toHaveBeenLastCalledWith({ workspaceId: "ws1" });

    library.toggleScopedTag("t-school");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockListNotes).toHaveBeenLastCalledWith({
      workspaceId: "ws1",
      tagIds: ["t-school"],
    });

    library.toggleScopedTag("t-school");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.scopedTagId).toBeNull();
    expect(mockListNotes).toHaveBeenLastCalledWith({ workspaceId: "ws1" });

    library.toggleScopedTag("t-school");
    await vi.advanceTimersByTimeAsync(0);
    library.selectWorkspace("ws2");
    expect(library.scopedTagId).toBeNull();
  });

  it("is inert outside a workspace and never leaks into the global tag filter", async () => {
    const library = await load();
    library.toggleScopedTag("t-anything");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.scopedTagId).toBeNull();

    mockListWorkspaceTags.mockResolvedValue([mkTagWithCount("t-x", "x")]);
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    library.toggleScopedTag("t-x");
    await vi.advanceTimersByTimeAsync(0);

    library.setTagFilter("t-global");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.scopedTagId).toBeNull();
    expect(mockListNotes).toHaveBeenLastCalledWith({ tagIds: ["t-global"] });
  });

  it("drops a scoped tag that vanished from the workspace's visible notes", async () => {
    const library = await load();
    mockListWorkspaceTags.mockResolvedValue([
      mkTagWithCount("t-school", "school"),
    ]);
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    library.toggleScopedTag("t-school");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.scopedTagId).toBe("t-school");

    // The last #school note was edited away; the chip data comes back empty.
    mockListWorkspaceTags.mockResolvedValue([]);
    await library.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(library.scopedTagId).toBeNull();
    expect(mockListNotes).toHaveBeenLastCalledWith({ workspaceId: "ws1" });
  });
});

describe("workspace delete with undo", () => {
  it("deletes immediately and the toast's Undo re-adds every member id", async () => {
    const library = await load();
    mockListWorkspaces.mockResolvedValue([mkWorkspace("ws1", "Movies")]);
    await library.refreshWorkspaces();
    mockDeleteWorkspace.mockResolvedValue(["n1", "n2", "n3"]);

    await library.removeWorkspace("ws1");
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws1");

    const { toasts } = await import("$lib/stores/toasts.svelte");
    expect(toasts.items).toHaveLength(1);
    expect(toasts.items[0].message).toBe('Deleted "Movies" - notes are kept');
    expect(toasts.items[0].action?.label).toBe("Undo");

    mockGetOrCreateWorkspace.mockResolvedValue(mkWorkspace("ws-new", "Movies"));
    mockAddNoteToWorkspace.mockResolvedValue(undefined);
    toasts.activate(toasts.items[0].id);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetOrCreateWorkspace).toHaveBeenCalledWith("Movies");
    for (const id of ["n1", "n2", "n3"]) {
      expect(mockAddNoteToWorkspace).toHaveBeenCalledWith(id, "ws-new");
    }
  });

  it("deleting the active workspace lands the view in All Notes", async () => {
    const library = await load();
    mockListWorkspaces.mockResolvedValue([mkWorkspace("ws1", "Doomed")]);
    await library.refreshWorkspaces();
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);

    mockListWorkspaces.mockResolvedValue([]);
    mockDeleteWorkspace.mockResolvedValue([]);
    await library.removeWorkspace("ws1");
    expect(library.activeWorkspaceId).toBeNull();
    expect(library.scopedTagId).toBeNull();
  });

  it("a partial undo (a member was destroyed meanwhile) reports what it restored", async () => {
    const library = await load();
    mockListWorkspaces.mockResolvedValue([mkWorkspace("ws1", "Movies")]);
    await library.refreshWorkspaces();
    mockDeleteWorkspace.mockResolvedValue(["n1", "n2"]);
    await library.removeWorkspace("ws1");

    const { toasts } = await import("$lib/stores/toasts.svelte");
    mockGetOrCreateWorkspace.mockResolvedValue(mkWorkspace("ws-new", "Movies"));
    mockAddNoteToWorkspace
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError("NOT_FOUND", "note n2 not found"));
    toasts.activate(toasts.items[0].id);
    await vi.advanceTimersByTimeAsync(0);

    expect(toasts.items).toHaveLength(1);
    expect(toasts.items[0].message).toBe(
      'Restored "Movies" without 1 of 2 notes.',
    );
  });
});

describe("workspace rename", () => {
  it("returns ok and refreshes the list on success", async () => {
    const library = await load();
    mockRenameWorkspace.mockResolvedValue(mkWorkspace("ws1", "Gamma"));
    mockListWorkspaces.mockClear();
    const result = await library.renameWorkspace("ws1", "Gamma");
    expect(result).toEqual({ ok: true });
    expect(mockRenameWorkspace).toHaveBeenCalledWith("ws1", "Gamma");
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("surfaces a duplicate name as an inline error, not a thrown error", async () => {
    const library = await load();
    mockRenameWorkspace.mockRejectedValue(new ApiError("CONFLICT", "exists"));
    const result = await library.renameWorkspace("ws1", "Beta");
    expect(result).toEqual({
      ok: false,
      message: "That name is already in use.",
    });
  });
});

describe("revisit mode (open-loop resurfacing)", () => {
  it("filters to never-opened captures older than the window, oldest first", async () => {
    const library = await load();
    library.selectRevisit();
    await vi.advanceTimersByTimeAsync(0);
    const filter = mockListNotes.mock.lastCall?.[0];
    expect(filter).toMatchObject({
      neverOpened: true,
      sortBy: "createdAt",
      sortOrder: "asc",
    });
    expect(typeof filter?.createdBefore).toBe("string");
  });

  it("keeps the count in lockstep, and opening a note burns it down live", async () => {
    const library = await load();
    mockListNotes.mockResolvedValue([mkNote("n1"), mkNote("n2")]);
    library.selectRevisit();
    await vi.advanceTimersByTimeAsync(0);
    expect(library.revisitCount).toBe(2);

    // getNote's touch releases n1; the store re-queries on open because the
    // backend emits no change event for a touch.
    mockListNotes.mockResolvedValue([mkNote("n2")]);
    await selectNote(library, "n1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.revisitCount).toBe(1);
    expect(library.notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("creating a note exits revisit mode, like it exits trash", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    library.selectRevisit();
    await library.newNote();
    // A brand-new note can never match the Revisit filter; staying in the
    // mode would hide the note the user just asked for.
    expect(library.revisitMode).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("leaves revisit mode when any other view is selected", async () => {
    const library = await load();
    library.selectRevisit();
    expect(library.revisitMode).toBe(true);
    library.selectWorkspace("ws1");
    expect(library.revisitMode).toBe(false);

    library.selectRevisit();
    library.setTagFilter("t1");
    expect(library.revisitMode).toBe(false);

    library.selectRevisit();
    library.setStatusFilter("archived");
    expect(library.revisitMode).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
  });
});
