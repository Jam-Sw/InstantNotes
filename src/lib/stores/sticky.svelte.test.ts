// The sticky window's note: it is the note's only editor while popped out, so
// its guarantees are the ones the library's save queue gives, plus one of its
// own: a change event never replaces the body being typed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getNote, updateNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";
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
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", { body: "milk, eggs" });
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
