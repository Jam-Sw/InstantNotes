import { describe, expect, it } from "vitest";
import { groupNotes } from "./note-groups";
import type { Note } from "$lib/api/types";

// Fixed local clock: mid-afternoon so day boundaries are unambiguous.
const NOW = new Date(2026, 6, 10, 15, 0, 0); // 2026-07-10 15:00 local

function mkNote(id: string, updatedAt: Date, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Note ${id}`,
    body: "",
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    ...overrides,
  };
}

function local(y: number, mo: number, d: number, h = 12): Date {
  return new Date(y, mo - 1, d, h);
}

describe("groupNotes", () => {
  it("buckets across every boundary in list order", () => {
    const notes = [
      mkNote("today", local(2026, 7, 10, 9)),
      mkNote("yesterday", local(2026, 7, 9, 23)),
      mkNote("week", local(2026, 7, 4)),
      mkNote("month", local(2026, 6, 15)),
      mkNote("this-year", local(2026, 3, 2)),
      mkNote("last-year", local(2025, 11, 30)),
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "Previous 7 Days",
      "Previous 30 Days",
      "March",
      "2025",
    ]);
    expect(groups.map((g) => g.notes.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("merges adjacent notes into one section", () => {
    const notes = [
      mkNote("a", local(2026, 7, 10, 9)),
      mkNote("b", local(2026, 7, 10, 8)),
      mkNote("c", local(2026, 7, 9, 20)),
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => [g.label, g.notes.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
    ]);
  });

  it("floats pinned notes into their own leading section", () => {
    const notes = [
      mkNote("pinned-old", local(2025, 2, 1), { isPinned: true }),
      mkNote("recent", local(2026, 7, 10, 9)),
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Today"]);
  });

  it("ignores a leftover pin flag in the trash so recency order holds", () => {
    const notes = [
      mkNote("t1", local(2026, 7, 10, 9), { isDeleted: true }),
      mkNote("t2", local(2026, 7, 9, 9), { isDeleted: true, isPinned: true }),
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("treats one minute past local midnight as Today, and just before as Yesterday", () => {
    const notes = [
      mkNote("after", new Date(2026, 6, 10, 0, 1)),
      mkNote("before", new Date(2026, 6, 9, 23, 59)),
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupNotes([], NOW)).toEqual([]);
  });
});
