import { describe, expect, it } from "vitest";
import type { Note } from "$lib/api/types";
import {
  buildMergeNotes,
  COPIES_NOTE_ID,
  isMergeNoteId,
  isMergeSpaceId,
  MERGE_SPACE_ID,
  pairNoteId,
} from "./space";

const note = (id: string, title: string, updatedAt: string): Note => ({
  id,
  title,
  body: "",
  createdAt: updatedAt,
  updatedAt,
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  contentKind: "document",
});

describe("merge space", () => {
  it("builds nothing for an empty review", () => {
    expect(buildMergeNotes({ combined: [], pairs: [] }, {})).toEqual([]);
  });

  it("puts the combined copies first, then one row per pair named after its note", () => {
    const known = {
      a: note("a", "Groceries", "2026-10-02T00:00:00.000Z"),
      b: note("b", "Groceries", "2026-10-05T00:00:00.000Z"),
    };
    const pair = { a: "a", b: "b", reason: "almost the same text" };
    const rows = buildMergeNotes(
      { combined: [{ kept: "k1", trashed: "t1" }, { kept: "k2", trashed: "t2" }], pairs: [pair] },
      known,
    );

    expect(rows.map((r) => r.id)).toEqual([COPIES_NOTE_ID, pairNoteId(pair)]);
    expect(rows[0].body).toBe("2 notes were on both devices, word for word. Each is one note now.");
    expect(rows[1].title).toBe("Groceries");
    expect(rows[1].body).toBe("Almost the same text");
    expect(rows[1].updatedAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("recognises its own Space and rows", () => {
    expect(isMergeSpaceId(MERGE_SPACE_ID)).toBe(true);
    expect(isMergeNoteId(COPIES_NOTE_ID)).toBe(true);
    expect(isMergeNoteId(pairNoteId({ a: "x", b: "y", reason: "" }))).toBe(true);
    expect(isMergeNoteId("x")).toBe(false);
  });
});
