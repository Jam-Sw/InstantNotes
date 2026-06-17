import { describe, expect, it } from "vitest";
import {
  childrenOf,
  filterCommands,
  findCommand,
  fuzzyScore,
  hasChildren,
  resolveActivation,
  type Command,
} from "./command-filter";

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

describe("command tree", () => {
  // A folder ("themes") with two leaves, plus two top-level commands.
  const tree: Command[] = [
    cmd("note.new", "New note"),
    cmd("themes", "Themes"),
    { ...cmd("theme.set.graphite", "Graphite"), parent: "themes" },
    { ...cmd("theme.set.paper", "Paper"), parent: "themes" },
    cmd("theme.toggle", "Toggle light / dark"),
  ];

  it("childrenOf returns the top level for a null parent", () => {
    expect(childrenOf(tree, null).map((c) => c.id)).toEqual([
      "note.new",
      "themes",
      "theme.toggle",
    ]);
  });

  it("childrenOf returns a folder's children", () => {
    expect(childrenOf(tree, "themes").map((c) => c.id)).toEqual([
      "theme.set.graphite",
      "theme.set.paper",
    ]);
  });

  it("hasChildren is true only for a folder", () => {
    expect(hasChildren(tree, "themes")).toBe(true);
    expect(hasChildren(tree, "theme.set.graphite")).toBe(false);
    expect(hasChildren(tree, "note.new")).toBe(false);
  });

  it("findCommand resolves by id and is safe for null or unknown ids", () => {
    expect(findCommand(tree, "themes")?.title).toBe("Themes");
    expect(findCommand(tree, null)).toBeUndefined();
    expect(findCommand(tree, "nope")).toBeUndefined();
  });
});

describe("resolveActivation", () => {
  const themeLeaf: Command = {
    ...cmd("theme.set.graphite", "Graphite"),
    parent: "themes",
    keepOpenAfterRun: true,
  };
  const tree: Command[] = [
    cmd("note.new", "New note"),
    cmd("themes", "Themes"),
    themeLeaf,
  ];

  it("descends into a command that has children", () => {
    expect(resolveActivation(tree, findCommand(tree, "themes")!)).toEqual({
      kind: "descend",
      parent: "themes",
    });
  });

  it("runs a plain leaf and closes the palette", () => {
    expect(resolveActivation(tree, findCommand(tree, "note.new")!)).toEqual({
      kind: "run",
      keepOpen: false,
    });
  });

  it("keeps the palette open for a value-picker leaf, regardless of where it was matched", () => {
    // Same leaf, whether reached from inside its folder or from a root search.
    expect(resolveActivation(tree, themeLeaf)).toEqual({
      kind: "run",
      keepOpen: true,
    });
  });
});
