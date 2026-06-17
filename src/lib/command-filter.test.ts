import { describe, expect, it } from "vitest";
import { filterCommands, fuzzyScore, type Command } from "./command-filter";

const cmd = (id: string, title: string): Command => ({
  id,
  title,
  group: "Test",
  run: () => {},
});

describe("fuzzyScore", () => {
  it("matches a subsequence", () => {
    expect(fuzzyScore("New note", "nn")).not.toBeNull();
    expect(fuzzyScore("New note", "newn")).not.toBeNull();
  });

  it("returns null when characters are missing or out of order", () => {
    expect(fuzzyScore("New note", "z")).toBeNull();
    // "tn" cannot be a subsequence: no n follows the only t.
    expect(fuzzyScore("New note", "tn")).toBeNull();
  });

  it("scores contiguous matches better than scattered ones", () => {
    const contiguous = fuzzyScore("theme", "the")!;
    const scattered = fuzzyScore("the home", "the")!;
    expect(contiguous).toBeLessThanOrEqual(scattered);
  });

  it("treats an empty query as a match", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("filterCommands", () => {
  const commands = [
    cmd("a", "New note"),
    cmd("b", "Pin note"),
    cmd("c", "Switch theme"),
    cmd("d", "Toggle light / dark"),
  ];

  it("returns all commands for an empty query", () => {
    expect(filterCommands(commands, "")).toHaveLength(4);
    expect(filterCommands(commands, "   ")).toHaveLength(4);
  });

  it("filters to matching commands", () => {
    const r = filterCommands(commands, "note");
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("ranks the closest match first", () => {
    const r = filterCommands(commands, "theme");
    expect(r[0].id).toBe("c");
  });

  it("drops everything when nothing matches", () => {
    expect(filterCommands(commands, "zzz")).toHaveLength(0);
  });
});
