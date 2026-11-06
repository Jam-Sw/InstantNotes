import { describe, expect, it } from "vitest";
import type { Note } from "$lib/api/types";
import {
  buildMergeNotes,
  copiedAt,
  COPIES_NOTE_ID,
  differenceLabel,
  differences,
  isMergeNoteId,
  isMergeSpaceId,
  MERGE_SPACE_ID,
  pairNoteId,
  sideNames,
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
    expect(rows[0].body).toBe("2 identical notes merged");
    expect(rows[1].title).toBe("Groceries");
    expect(rows[1].body).toBe("Almost the same text");
    expect(rows[1].updatedAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("names a tag-only conflict copy after the original and says what differs", () => {
    const known = {
      a: { ...note("a", "Release notes", "2026-10-02T00:00:00.000Z"), isPinned: true },
      b: note("b", "Release notes (conflict 2026-10-02 09:14)", "2026-10-02T00:00:00.000Z"),
    };
    const labels = {
      a: { tags: ["instantnotesupdates"], spaces: [] },
      b: { tags: ["conflict"], spaces: [] },
    };
    const pair = { a: "a", b: "b", reason: "changed in two places" };
    const [row] = buildMergeNotes({ combined: [], pairs: [pair] }, known, labels);

    expect(row.title).toBe("Release notes");
    expect(row.body).toBe("Tags differ");
    expect(copiedAt(known.b.title)).toBe("2026-10-02 09:14");
    expect(sideNames(pair.reason)).toEqual(["Original", "Copy"]);
  });

  it("lists every kind of difference in one label", () => {
    const a = note("a", "Plan", "2026-10-02T00:00:00.000Z");
    const b = { ...note("b", "Plan v2", "2026-10-02T00:00:00.000Z"), body: "x", isPinned: true };
    const none = { tags: [], spaces: [] };

    expect(differenceLabel(differences(a, b, none, { tags: [], spaces: ["Work"] }))).toBe(
      "Text, title, Spaces and pin differ",
    );
    expect(differenceLabel(differences(a, a, none, none))).toBe("No difference");
  });

  it("recognises its own Space and rows", () => {
    expect(isMergeSpaceId(MERGE_SPACE_ID)).toBe(true);
    expect(isMergeNoteId(COPIES_NOTE_ID)).toBe(true);
    expect(isMergeNoteId(pairNoteId({ a: "x", b: "y", reason: "" }))).toBe(true);
    expect(isMergeNoteId("x")).toBe(false);
  });
});
