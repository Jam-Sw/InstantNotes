// The sticky window's note: it is the note's only editor while popped out, so
// its guarantees are the ones the library's save queue gives, plus one of its
// own: a change event never replaces the body being typed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getNote, updateNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";
import { SAVE_CONFLICT_MESSAGE } from "$lib/errors";
import type { AgentActivity } from "$lib/agent-activity";
import { agents } from "./agents.svelte";
import { toasts } from "./toasts.svelte";
import { StickyNote } from "./sticky.svelte";

vi.mock("$lib/api/client", () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, getNote: vi.fn(), updateNote: vi.fn() };
});

const mockGetNote = vi.mocked(getNote);
const mockUpdateNote = vi.mocked(updateNote);

function mkNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Groceries",
    body: "milk",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document",
    ...overrides,
  };
}

async function loaded(): Promise<StickyNote> {
  const sticky = new StickyNote();
  mockGetNote.mockResolvedValueOnce(mkNote());
  await sticky.load("n1");
  return sticky;
}

beforeEach(() => {
  mockGetNote.mockReset();
  mockUpdateNote.mockReset();
});

describe("StickyNote", () => {
  it("opens the note as touched, like opening it in the library", async () => {
    const sticky = await loaded();
    expect(mockGetNote).toHaveBeenCalledWith("n1", true);
    expect(sticky.note?.body).toBe("milk");
  });

  it("flushes a typed edit and reports it saved", async () => {
    const sticky = await loaded();
    mockUpdateNote.mockResolvedValue(mkNote({ body: "milk, eggs" }));
    sticky.editBody("milk, eggs");

    expect(await sticky.flush()).toBe(true);
    // Based on the version it opened, so an agent's write in between is seen.
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "milk, eggs",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
    });
    expect(sticky.saveState).toBe("saved");
  });

  it("reports a failed flush so the window stays open with the text", async () => {
    const sticky = await loaded();
    mockUpdateNote.mockRejectedValue(new ApiError("STORAGE_ERROR", "locked"));
    sticky.editBody("milk, eggs");

    expect(await sticky.flush()).toBe(false);
    expect(sticky.note?.body).toBe("milk, eggs");
    expect(sticky.saveState).toBe("failed");
  });

  it("asks a whiteboard for its batched canvas before flushing", async () => {
    const sticky = new StickyNote();
    mockGetNote.mockResolvedValueOnce(mkNote({ contentKind: "whiteboard", surfaceData: "{}" }));
    await sticky.load("n1");
    mockUpdateNote.mockResolvedValue(mkNote({ contentKind: "whiteboard" }));
    sticky.onBeforeFlush(() => sticky.editBoard("n1", { surfaceData: '{"a":1}', body: "a" }));

    await sticky.flush();

    expect(mockUpdateNote).toHaveBeenCalledWith("n1", { surfaceData: '{"a":1}', body: "a" });
  });

  it("takes new metadata from a change event but keeps its own body", async () => {
    const sticky = await loaded();
    mockUpdateNote.mockResolvedValue(mkNote());
    sticky.editBody("typing, not yet saved");
    mockGetNote.mockResolvedValueOnce(mkNote({ title: "Renamed", isPinned: true, body: "disk" }));

    await sticky.refreshMeta();

    expect(sticky.note?.title).toBe("Renamed");
    expect(sticky.note?.isPinned).toBe(true);
    expect(sticky.note?.body).toBe("typing, not yet saved");
  });

  it("goes quiet when its note is trashed or destroyed behind it", async () => {
    const trashed = await loaded();
    mockGetNote.mockResolvedValueOnce(mkNote({ isDeleted: true }));
    await trashed.refreshMeta();
    expect(trashed.gone).toBe(true);
    trashed.editBody("after the trash");
    expect(trashed.note?.body).toBe("milk");

    const destroyed = await loaded();
    mockGetNote.mockRejectedValueOnce(new ApiError("NOT_FOUND", "gone"));
    await destroyed.refreshMeta();
    expect(destroyed.gone).toBe(true);
    // Nothing is left queued against a row that no longer exists.
    expect(await destroyed.flush()).toBe(true);
    expect(mockUpdateNote).not.toHaveBeenCalled();
  });
});

describe("StickyNote when an agent writes its note", () => {
  const write = (noteId: string): AgentActivity => ({
    seq: 1,
    at: 1,
    session: "s1",
    client: "claude-code",
    tool: "append_to_note",
    kind: "write",
    status: "ok",
    error: null,
    durationMs: 1,
    noteIds: [noteId],
    noteCount: 1,
    titles: ["Groceries"],
    space: null,
    tag: null,
    query: null,
    afterUpdatedAt: null,
    revertable: true,
    revertedAt: null,
    reverts: null,
  });

  it("takes the agent's version in place when nothing is unsaved", async () => {
    const sticky = await loaded();
    mockGetNote.mockResolvedValueOnce(
      mkNote({ body: "milk\n- bread", updatedAt: "2026-01-01T00:05:00Z" }),
    );

    await sticky.adoptExternal([write("other"), { ...write("n1"), kind: "read" }]);
    expect(sticky.note?.body).toBe("milk");

    await sticky.adoptExternal([write("n1")]);
    expect(sticky.note?.body).toBe("milk\n- bread");

    // The next save is based on the agent's version: no conflict, no toast.
    mockUpdateNote.mockResolvedValueOnce(mkNote({ body: "milk\n- bread!" }));
    sticky.editBody("milk\n- bread!");
    await sticky.flush();
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "milk\n- bread!",
      expectedUpdatedAt: "2026-01-01T00:05:00Z",
    });
  });

  it("keeps unsaved typing, then names the agent and offers its text back", async () => {
    const sticky = await loaded();
    agents.play([write("n1")]);
    sticky.editBody("milk, mine");
    await sticky.adoptExternal([write("n1")]);
    expect(sticky.note?.body).toBe("milk, mine");

    const theirs = "milk\n- bread";
    mockUpdateNote
      .mockRejectedValueOnce(new ApiError("CONFLICT", "changed"))
      .mockResolvedValueOnce(mkNote({ body: "milk, mine", updatedAt: "2026-01-01T00:06:00Z" }));
    mockGetNote.mockResolvedValueOnce(mkNote({ body: theirs, updatedAt: "2026-01-01T00:05:00Z" }));

    expect(await sticky.flush()).toBe(true);
    const toast = toasts.items.at(-1)!;
    expect(toast.message).toBe("Claude Code's change to this note was replaced by your typing.");

    // Restoring is an ordinary edit in this window.
    mockUpdateNote.mockResolvedValueOnce(mkNote({ body: theirs }));
    toast.action!.run();
    expect(sticky.note?.body).toBe(theirs);
    await sticky.flush();
    expect(mockUpdateNote).toHaveBeenLastCalledWith("n1", {
      body: theirs,
      expectedUpdatedAt: "2026-01-01T00:06:00Z",
    });
  });

  it("appends an agent's rows to a sheet being edited, and saves them along", async () => {
    const grid = (rows: string[][]) =>
      JSON.stringify({ v: 1, engine: "grid", data: { cols: rows[0].map(() => ({ w: 120 })), rows } });
    const rowsOf = (raw: string | null | undefined) => JSON.parse(raw ?? "").data.rows as string[][];
    const sticky = new StickyNote();
    mockGetNote.mockResolvedValueOnce(
      mkNote({ contentKind: "sheet", surfaceData: grid([["h"], ["1"], [""]]) }),
    );
    await sticky.load("n1");
    sticky.editSheet("n1", grid([["h"], ["1"], ["2"]]));
    mockGetNote.mockResolvedValueOnce(
      mkNote({ contentKind: "sheet", surfaceData: grid([["h"], ["1"], ["a"]]), updatedAt: "2026-01-01T00:05:00Z" }),
    );

    await sticky.adoptExternal([write("n1")]);
    expect(rowsOf(sticky.note?.surfaceData)).toEqual([["h"], ["1"], ["2"], ["a"]]);

    mockUpdateNote.mockResolvedValueOnce(mkNote({ contentKind: "sheet", body: "| h |\n| --- |" }));
    expect(await sticky.flush()).toBe(true);
    const [, patch] = mockUpdateNote.mock.calls[0];
    expect(rowsOf(patch.surfaceData)).toEqual([["h"], ["1"], ["2"], ["a"]]);
    expect(patch.expectedUpdatedAt).toBe("2026-01-01T00:05:00Z");
    expect(sticky.note?.body).toBe("| h |\n| --- |");
  });

  it("says a save lost the race, not that a name is taken", async () => {
    const sticky = await loaded();
    sticky.editBody("milk, mine");
    mockUpdateNote.mockRejectedValue(new ApiError("CONFLICT", "changed"));
    mockGetNote.mockResolvedValue(mkNote({ body: "milk, theirs" }));

    await sticky.flush();
    expect(sticky.error).toBe(SAVE_CONFLICT_MESSAGE);
  });
});
