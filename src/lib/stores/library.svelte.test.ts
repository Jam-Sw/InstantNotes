import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNoteToWorkspace,
  ApiError,
  countNotes,
  createNote,
  deleteWorkspace,
  destroyNotes,
  getNote,
  getOrCreateWorkspace,
  listNotes,
  listTags,
  listWorkspaces,
  listStickies,
  listWorkspaceTags,
  popInNote,
  popOutNote,
  renameWorkspace,
  searchNotes,
  softDeleteNote,
  softDeleteNotes,
  tagsForNote,
  updateNote,
  workspacesForNote,
} from "$lib/api/client";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "$lib/api/events";
import { UPDATE_NOTE_ID, UPDATE_SPACE_ID } from "$lib/update/space";
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
    destroyNotes: vi.fn(),
    listNotes: vi.fn(),
    countNotes: vi.fn().mockResolvedValue(0),
    searchNotes: vi.fn(),
    spaceSuggestions: vi.fn().mockResolvedValue([]),
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
    listStickies: vi.fn(),
    popOutNote: vi.fn(),
    popInNote: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: vi.fn((skeletons: object[]) =>
    skeletons.map((sk, i) => ({ ...sk, id: `el${i}`, version: 1 })),
  ),
}));

const mockCreateNote = vi.mocked(createNote);
const mockGetNote = vi.mocked(getNote);
const mockUpdateNote = vi.mocked(updateNote);
const mockListNotes = vi.mocked(listNotes);
const mockCountNotes = vi.mocked(countNotes);
const mockSearchNotes = vi.mocked(searchNotes);
const mockListTags = vi.mocked(listTags);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockTagsForNote = vi.mocked(tagsForNote);
const mockWorkspacesForNote = vi.mocked(workspacesForNote);
const mockDestroyNotes = vi.mocked(destroyNotes);
const mockSoftDeleteNote = vi.mocked(softDeleteNote);
const mockSoftDeleteNotes = vi.mocked(softDeleteNotes);
const mockDeleteWorkspace = vi.mocked(deleteWorkspace);
const mockRenameWorkspace = vi.mocked(renameWorkspace);
const mockGetOrCreateWorkspace = vi.mocked(getOrCreateWorkspace);
const mockAddNoteToWorkspace = vi.mocked(addNoteToWorkspace);
const mockListWorkspaceTags = vi.mocked(listWorkspaceTags);
const mockListen = vi.mocked(listen);
const mockListStickies = vi.mocked(listStickies);
const mockPopOutNote = vi.mocked(popOutNote);
const mockPopInNote = vi.mocked(popInNote);

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  mockListStickies.mockReset().mockResolvedValue([]);
  mockPopOutNote.mockReset().mockResolvedValue(undefined);
  mockPopInNote.mockReset().mockResolvedValue(undefined);
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
    expect(library.saveState).toBe("saving");
    expect(mockUpdateNote).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "new body",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
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
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "flush me",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });

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

    expect(library.saveState).toBe("failed");
    expect(library.error).toBe(
      "Your note couldn't be saved. Please try again.",
    );
  });

  it("fixed: a flush of one dirty note performs exactly one write attempt, and no timer survives once it resolves", async () => {
    const library = await load();
    await selectNote(library, "n1");

    mockUpdateNote.mockRejectedValue(new ApiError("STORAGE_ERROR", "locked"));

    library.editBody("stray retry");
    await library.flushPendingEdits();
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    expect(library.saveState).toBe("failed");

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
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockResolvedValue(mkNote("n1", { body: "kept" }));

    library.editBody("kept");
    await vi.advanceTimersByTimeAsync(400);

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "kept",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
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
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    expect(mockSoftDeleteNote).toHaveBeenCalledWith("n1");
    const write = mockUpdateNote.mock.invocationCallOrder[0];
    const trash = mockSoftDeleteNote.mock.invocationCallOrder[0];
    expect(write).toBeLessThan(trash);
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
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
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
    expect(library.notes.map((n) => n.id)).toEqual(["newer"]);
  });

  it("a slow older search refresh cannot clobber a newer one", async () => {
    const library = await load();
    library.setSearch("q");
    await vi.advanceTimersByTimeAsync(0);

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
    expect(mockListNotes).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
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
      EVENTS.NOTES_CHANGED,
      EVENTS.TAGS_CHANGED,
      EVENTS.WORKSPACES_CHANGED,
      EVENTS.STICKIES_CHANGED,
      EVENTS.LIBRARY_EXTERNAL_CHANGE,
    ]);
    expect(mockListNotes).not.toHaveBeenCalled();
    expect(mockListTags).not.toHaveBeenCalled();
    expect(mockListWorkspaces).not.toHaveBeenCalled();

    gate.resolve(() => {});
    await initPromise;

    expect(mockListNotes).toHaveBeenCalledTimes(1);
    expect(mockCountNotes).toHaveBeenCalledTimes(1);
    expect(mockListTags).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("guards against double invocation: a second concurrent call does no extra work", async () => {
    const library = await load();

    const p1 = library.init();
    const p2 = library.init();
    await Promise.all([p1, p2]);

    expect(mockListen).toHaveBeenCalledTimes(5);
    expect(mockListNotes).toHaveBeenCalledTimes(1);
    expect(mockCountNotes).toHaveBeenCalledTimes(1);
    expect(mockListTags).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("wires the notes:changed listener to a debounced refresh", async () => {
    const library = await load();
    await library.init();
    mockListNotes.mockClear();
    mockCountNotes.mockClear();

    const handler = mockListen.mock.calls.find(
      (c) => c[0] === EVENTS.NOTES_CHANGED,
    )?.[1] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    handler!();

    expect(mockListNotes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(mockListNotes).toHaveBeenCalledTimes(1);
    expect(mockCountNotes).toHaveBeenCalledTimes(1);
  });
});

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
    expect(filter).toEqual({ revisit: true });
  });

  it("keeps the count in lockstep, and opening a note burns it down live", async () => {
    const library = await load();
    mockListNotes.mockResolvedValue([mkNote("n1"), mkNote("n2")]);
    library.selectRevisit();
    await vi.advanceTimersByTimeAsync(0);
    expect(library.revisitCount).toBe(2);

    mockListNotes.mockResolvedValue([mkNote("n2")]);
    await selectNote(library, "n1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.revisitCount).toBe(1);
    expect(library.notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("counts the open loops with a count, not by listing them", async () => {
    mockCountNotes.mockResolvedValue(7);
    const library = await load();
    await library.init();
    expect(library.revisitCount).toBe(7);
    expect(mockCountNotes).toHaveBeenLastCalledWith({ revisit: true });
  });

  it("creating a note exits revisit mode, like it exits trash", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    library.selectRevisit();
    await library.newNote();
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

describe("whiteboards", () => {
  const BOARD = JSON.stringify({
    v: 1,
    engine: "excalidraw",
    data: { elements: [], appState: {}, files: {} },
  });

  it("queues a board save like a body edit and persists canvas and text together", async () => {
    const library = await load();
    await selectNote(library, "b1", { contentKind: "whiteboard", surfaceData: BOARD });
    mockUpdateNote.mockResolvedValue(mkNote("b1", { contentKind: "whiteboard" }));

    library.editBoard("b1", { surfaceData: "next", body: "words" });
    expect(library.saveState).toBe("saving");
    expect(library.selected?.surfaceData).toBe("next");
    expect(library.selected?.body).toBe("words");

    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledWith("b1", { surfaceData: "next", body: "words" });
    await vi.advanceTimersByTimeAsync(0);
    expect(library.saveState).toBe("saved");
    expect(library.selected?.surfaceData).toBe("next");
  });

  it("quit collects a board's unsent change before flushing", async () => {
    const library = await load();
    await selectNote(library, "b1", { contentKind: "whiteboard", surfaceData: BOARD });
    mockUpdateNote.mockResolvedValue(mkNote("b1", { contentKind: "whiteboard" }));
    const off = library.onBeforeFlush(() =>
      library.editBoard("b1", { surfaceData: "last stroke", body: "" }),
    );

    await library.flushPendingEdits();
    expect(mockUpdateNote).toHaveBeenCalledWith("b1", { surfaceData: "last stroke", body: "" });

    off();
    mockUpdateNote.mockClear();
    await library.flushPendingEdits();
    expect(mockUpdateNote).not.toHaveBeenCalled();
  });

  it("switching notes collects the board's unsent change for the board, not the next note", async () => {
    const library = await load();
    await selectNote(library, "b1", { contentKind: "whiteboard", surfaceData: BOARD });
    mockUpdateNote.mockResolvedValue(mkNote("b1", { contentKind: "whiteboard" }));
    library.onBeforeFlush(() => library.editBoard("b1", { surfaceData: "drawn", body: "" }));

    await selectNote(library, "n2");
    await vi.advanceTimersByTimeAsync(0);
    expect(mockUpdateNote).toHaveBeenCalledWith("b1", { surfaceData: "drawn", body: "" });
    expect(library.selected?.id).toBe("n2");
    expect(library.selected?.surfaceData).toBeUndefined();
  });

  it("reopening a board with an unsaved change shows the change, not the disk copy", async () => {
    const library = await load();
    await selectNote(library, "b1", { contentKind: "whiteboard", surfaceData: BOARD });
    mockUpdateNote.mockReturnValue(new Promise(() => {}));
    library.editBoard("b1", { surfaceData: "unsaved", body: "text" });
    await selectNote(library, "n2");
    await selectNote(library, "b1", { contentKind: "whiteboard", surfaceData: BOARD });
    expect(library.selected?.surfaceData).toBe("unsaved");
    expect(library.selected?.body).toBe("text");
  });

  it("converting lays the note's text onto the board as one text element", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "Roadmap\nship it" });
    mockUpdateNote.mockResolvedValue(mkNote("n1", { contentKind: "whiteboard" }));

    library.editBody("Roadmap\nship it today");
    await library.convertToWhiteboard();

    const calls = mockUpdateNote.mock.calls;
    expect(calls[0]).toEqual([
      "n1",
      { body: "Roadmap\nship it today", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
    const [id, patch] = calls[calls.length - 1];
    expect(id).toBe("n1");
    expect(patch.contentKind).toBe("whiteboard");
    const board = JSON.parse(patch.surfaceData as string);
    expect(board.engine).toBe("excalidraw");
    expect(board.data.elements).toHaveLength(1);
    expect(board.data.elements[0]).toMatchObject({
      type: "text",
      text: "Roadmap\nship it today",
    });
    expect(library.selected?.contentKind).toBe("whiteboard");
    expect(library.selected?.surfaceData).toBe(patch.surfaceData);
  });

  it("converting an empty note gives an empty board", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "   " });
    mockUpdateNote.mockResolvedValue(mkNote("n1", { contentKind: "whiteboard" }));
    await library.convertToWhiteboard();
    const patch = mockUpdateNote.mock.calls[0][1];
    expect(JSON.parse(patch.surfaceData as string).data.elements).toEqual([]);
  });

  it("does not convert a trashed note or a board", async () => {
    const library = await load();
    await selectNote(library, "n1", { isDeleted: true });
    await library.convertToWhiteboard();
    await selectNote(library, "b1", { contentKind: "whiteboard" });
    await library.convertToWhiteboard();
    expect(mockUpdateNote).not.toHaveBeenCalled();
  });

  it("New whiteboard never converts the open note when creating the new one fails", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "my writing" });
    mockCreateNote.mockRejectedValue(new Error("disk full"));
    await library.newWhiteboard();
    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(library.selected?.contentKind).toBe("document");
  });

  it("New whiteboard creates a note and opens it as an empty board", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    mockUpdateNote.mockResolvedValue(mkNote("new1", { contentKind: "whiteboard" }));

    await library.newWhiteboard();

    expect(mockCreateNote).toHaveBeenCalled();
    const [id, patch] = mockUpdateNote.mock.calls[0];
    expect(id).toBe("new1");
    expect(patch.contentKind).toBe("whiteboard");
    expect(library.selected?.contentKind).toBe("whiteboard");
  });
});

describe("sheets", () => {
  const grid = (rows: string[][]) =>
    JSON.stringify({ v: 1, engine: "grid", data: { cols: rows[0].map(() => ({ w: 120 })), rows } });
  const GRID = grid([["Date", "ms"], ["d1", "1"], ["", ""]]);
  const TABLE = "| Date | ms |\n| --- | --- |\n| d1 | 1 |";

  it("queues a grid save like a body edit, with the version it was based on, and shows the store's table", async () => {
    const library = await load();
    await selectNote(library, "s1", { contentKind: "sheet", surfaceData: GRID, body: TABLE });
    const next = grid([["Date", "ms"], ["d1", "1"], ["d2", "2"]]);
    mockUpdateNote.mockResolvedValue(
      mkNote("s1", { contentKind: "sheet", body: `${TABLE}\n| d2 | 2 |`, updatedAt: "2026-01-01T00:01:00Z" }),
    );

    library.editSheet("s1", next);
    expect(library.saveState).toBe("saving");
    expect(library.selected?.surfaceData).toBe(next);
    expect(library.selected?.body).toBe(TABLE);

    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledWith("s1", {
      surfaceData: next,
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(library.saveState).toBe("saved");
    expect(library.selected?.body).toBe(`${TABLE}\n| d2 | 2 |`);
    expect(library.selected?.surfaceData).toBe(next);
  });

  it("quit and a note switch collect the cell still being typed in", async () => {
    const library = await load();
    await selectNote(library, "s1", { contentKind: "sheet", surfaceData: GRID });
    mockUpdateNote.mockResolvedValue(mkNote("s1", { contentKind: "sheet" }));
    const off = library.onBeforeFlush(() => library.editSheet("s1", "typed"));

    await library.flushPendingEdits();
    expect(mockUpdateNote).toHaveBeenCalledWith("s1", {
      surfaceData: "typed",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    off();
  });

  it("New sheet creates a note and makes it a sheet; the store supplies the grid", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    mockUpdateNote.mockResolvedValue(mkNote("new1", { contentKind: "sheet", title: "Untitled sheet" }));

    await library.newSheet();

    expect(mockCreateNote).toHaveBeenCalled();
    expect(mockUpdateNote).toHaveBeenCalledWith("new1", { contentKind: "sheet" });
    expect(library.selected?.contentKind).toBe("sheet");
    expect(library.selected?.title).toBe("Untitled sheet");
  });

  it("New sheet never converts the open note when creating the new one fails", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "my writing" });
    mockCreateNote.mockRejectedValue(new Error("disk full"));
    await library.newSheet();
    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(library.selected?.contentKind).toBe("document");
  });
});

describe("graph view", () => {
  it("is its own place: entering it leaves every other view", async () => {
    const library = await load();
    library.selectWorkspace("ws1");
    library.selectGraph();
    expect(library.graphMode).toBe(true);
    expect(library.activeWorkspaceId).toBeNull();
    expect(library.revisitMode).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("any other place in the sidebar leaves it", async () => {
    const library = await load();
    for (const go of [
      () => library.selectWorkspace(null),
      () => library.selectWorkspace("ws1"),
      () => library.selectRevisit(),
      () => library.setTagFilter("t1"),
      () => library.setStatusFilter("archived"),
    ]) {
      library.selectGraph();
      go();
      expect(library.graphMode).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(0);
  });

  it("opening a note leaves it, so the note is what shows", async () => {
    const library = await load();
    library.selectGraph();
    await selectNote(library, "n1");
    expect(library.graphMode).toBe(false);
    expect(library.selected?.id).toBe("n1");
  });

  it("creating a note leaves it", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    library.selectGraph();
    await library.newNote();
    expect(library.graphMode).toBe(false);
  });
});

describe("space suggestions", () => {
  it("keeps the suggestions along with their count", async () => {
    const library = await load();
    const { spaceSuggestions } = await import("$lib/api/client");
    const suggestion = {
      noteId: "n1",
      noteTitle: "Lasagne",
      spaceId: "ws1",
      spaceName: "Recipes",
      probability: 0.9,
      reasons: [],
    };
    vi.mocked(spaceSuggestions).mockResolvedValueOnce([suggestion]);
    await library.refreshSuggestionCount();
    expect(library.suggestions).toEqual([suggestion]);
    expect(library.suggestionCount).toBe(1);
  });
});

describe("the update Space (synthetic)", () => {
  it("is never queried and holds no store rows of its own", async () => {
    const library = await load();
    mockListNotes.mockClear();

    library.selectWorkspace(UPDATE_SPACE_ID);
    await vi.advanceTimersByTimeAsync(0);

    expect(library.activeWorkspaceId).toBe(UPDATE_SPACE_ID);
    expect(mockListNotes).not.toHaveBeenCalled();
    expect(library.notes).toEqual([]);
  });

  it("opens a synthetic note without fetching it, and keeps its edits local", async () => {
    const library = await load();
    const note = mkNote(UPDATE_NOTE_ID, { title: "update 0.9.0 → 0.10.0" });

    library.selectVirtual(note);
    expect(library.selected?.id).toBe(UPDATE_NOTE_ID);
    expect(library.selectedTags).toEqual([]);
    expect(mockGetNote).not.toHaveBeenCalled();

    library.editBody("typed into the release notes");
    expect(library.selected?.body).toBe("typed into the release notes");
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockUpdateNote).not.toHaveBeenCalled();
    expect(library.saveState).not.toBe("saving");
  });

  it("a new note is not filed under the synthetic Space", async () => {
    const library = await load();
    mockCreateNote.mockResolvedValue(mkNote("new1"));
    mockGetNote.mockResolvedValue(mkNote("new1"));
    library.selectWorkspace(UPDATE_SPACE_ID);
    await vi.advanceTimersByTimeAsync(0);

    await library.newNote();

    expect(library.activeWorkspaceId).toBeNull();
    expect(mockAddNoteToWorkspace).not.toHaveBeenCalled();
  });
});

describe("stickies", () => {
  it("writes the note's pending edit before popping it out", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockResolvedValue(mkNote("n1", { body: "typed" }));
    library.editBody("typed");
    mockListStickies.mockResolvedValue(["n1"]);

    await library.popOut("n1");

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "typed",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    expect(mockUpdateNote.mock.invocationCallOrder[0]).toBeLessThan(
      mockPopOutNote.mock.invocationCallOrder[0],
    );
    expect(library.isSticky("n1")).toBe(true);
  });

  it("keeps the note here when its pending edit cannot be written", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockUpdateNote.mockRejectedValue(new ApiError("STORAGE_ERROR", "locked"));
    library.editBody("typed");

    await library.popOut("n1");

    expect(mockPopOutNote).not.toHaveBeenCalled();
    expect(library.isSticky("n1")).toBe(false);
  });

  it("stops editing a note while it is a sticky", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "disk" });
    mockListStickies.mockResolvedValue(["n1"]);
    await library.refreshStickies();

    library.editBody("from the library");
    library.editTitle("Renamed");
    library.editBoard("n1", { surfaceData: "{}", body: "board" });
    await vi.advanceTimersByTimeAsync(3000);

    expect(library.selected?.body).toBe("disk");
    expect(mockUpdateNote).not.toHaveBeenCalled();
  });

  it("reopens the note from disk when its sticky comes back", async () => {
    const library = await load();
    await selectNote(library, "n1", { body: "before" });
    mockListStickies.mockResolvedValue(["n1"]);
    await library.refreshStickies();

    mockListStickies.mockResolvedValue([]);
    mockGetNote.mockResolvedValueOnce(mkNote("n1", { body: "typed in the sticky" }));
    await library.popIn("n1");

    expect(mockPopInNote).toHaveBeenCalledWith("n1");
    expect(library.isSticky("n1")).toBe(false);
    expect(library.selected?.body).toBe("typed in the sticky");
  });

  it("brings a sticky back before trashing its note, and not at all if it cannot save", async () => {
    const library = await load();
    await selectNote(library, "n1");
    mockListStickies.mockResolvedValue(["n1"]);
    await library.refreshStickies();

    mockPopInNote.mockRejectedValueOnce(new ApiError("STORAGE_ERROR", "sticky kept"));
    await library.deleteSelected();
    expect(mockSoftDeleteNote).not.toHaveBeenCalled();

    mockListStickies.mockResolvedValue([]);
    mockGetNote.mockResolvedValue(mkNote("n1"));
    mockSoftDeleteNote.mockResolvedValue(mkNote("n1", { isDeleted: true }));
    await library.deleteSelected();
    expect(mockPopInNote).toHaveBeenCalledTimes(2);
    expect(mockSoftDeleteNote).toHaveBeenCalledWith("n1");
  });
});

describe("each view remembers its open note", () => {
  it("reopens the note left open in a Space when that Space is shown again", async () => {
    const library = await load();
    mockListNotes.mockImplementation(async (f) =>
      f?.workspaceId === "ws1" ? [mkNote("a"), mkNote("b")] : [mkNote("c")],
    );
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "b");

    library.selectWorkspace("ws2");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected).toBeNull();

    mockGetNote.mockResolvedValueOnce(mkNote("b"));
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected?.id).toBe("b");
  });

  it("does not reopen a note that has left the Space, or one closed before leaving", async () => {
    const library = await load();
    let ws1 = [mkNote("a")];
    mockListNotes.mockImplementation(async (f) => (f?.workspaceId === "ws1" ? ws1 : []));
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "a");
    library.selectWorkspace("ws2");
    await vi.advanceTimersByTimeAsync(0);

    ws1 = [];
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected).toBeNull();

    ws1 = [mkNote("a")];
    library.selectWorkspace("ws2");
    await vi.advanceTimersByTimeAsync(0);
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected).toBeNull();
    expect(mockGetNote).toHaveBeenCalledTimes(1);
  });

  it("lets a note opened right after the switch win over the remembered one", async () => {
    const library = await load();
    mockListNotes.mockResolvedValue([mkNote("a"), mkNote("x")]);
    library.selectWorkspace(null);
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "a");
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);

    mockGetNote.mockResolvedValueOnce(mkNote("x"));
    library.selectWorkspace(null);
    const opening = library.select("x");
    await vi.advanceTimersByTimeAsync(0);
    await opening;
    expect(library.selected?.id).toBe("x");
    expect(mockGetNote).toHaveBeenLastCalledWith("x", true);
  });

  it("carries the open note into a Space that lists it", async () => {
    const library = await load();
    mockListNotes.mockImplementation(async (f) =>
      f?.workspaceId === "ws1" ? [mkNote("b")] : [mkNote("a"), mkNote("b")],
    );
    library.selectWorkspace(null);
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "b");

    mockGetNote.mockResolvedValueOnce(mkNote("b"));
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected?.id).toBe("b");
  });

  it("returns to the open note after a status pill round trip", async () => {
    const library = await load();
    mockListNotes.mockImplementation(async (f) =>
      f?.isArchived || f?.isDeleted ? [] : [mkNote("a")],
    );
    library.selectWorkspace(null);
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "a");

    library.setStatusFilter("archived");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected).toBeNull();

    mockGetNote.mockResolvedValueOnce(mkNote("a"));
    library.setStatusFilter("active");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected?.id).toBe("a");
  });

  it("returns to the open note when its chip is toggled off", async () => {
    const library = await load();
    mockListWorkspaceTags.mockResolvedValue([mkTagWithCount("t1", "one")]);
    mockListNotes.mockImplementation(async (f) =>
      f?.tagIds ? [] : [mkNote("a")],
    );
    library.selectWorkspace("ws1");
    await vi.advanceTimersByTimeAsync(0);
    await selectNote(library, "a");

    library.toggleScopedTag("t1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected).toBeNull();

    mockGetNote.mockResolvedValueOnce(mkNote("a"));
    library.toggleScopedTag("t1");
    await vi.advanceTimersByTimeAsync(0);
    expect(library.selected?.id).toBe("a");
  });

  it("writes a pending edit before leaving the view", async () => {
    const library = await load();
    mockListNotes.mockResolvedValue([mkNote("a")]);
    mockUpdateNote.mockResolvedValue(mkNote("a", { body: "typed" }));
    await selectNote(library, "a");
    library.editBody("typed");
    expect(mockUpdateNote).not.toHaveBeenCalled();
    library.selectWorkspace("ws1");
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });
});
