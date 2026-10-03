import { describe, it, expect } from "vitest";
import { LAYOUT_TICKS, buildGraph, neighbors, startLayout, type Graph } from "./layout";

/** A layout run to rest in one go (`ticks: 0` gives the starting positions):
 *  what the view does frame by frame, done at once for the assertions. */
function layoutGraph(
  graph: Graph,
  options: { previous?: Map<string, { x: number; y: number }>; ticks?: number } = {},
): Graph {
  const run = startLayout(graph, options.previous);
  run.step(options.ticks ?? LAYOUT_TICKS);
  return run.snapshot();
}
import type { LibraryGraph, SpaceSuggestion } from "$lib/api/types";

const note = (id: string, title = id, extra = {}) => ({
  id,
  title,
  contentKind: "document" as const,
  isPinned: false,
  ...extra,
});

function library(): LibraryGraph {
  return {
    notes: [note("n1", "Alpha"), note("n2", "Beta"), note("n3", "Gamma"), note("lone")],
    tags: [
      { id: "t1", name: "ideas", color: "#ff8800" },
      { id: "t2", name: "unused" },
    ],
    spaces: [{ id: "s1", name: "Research" }],
    links: [
      { noteId: "n1", targetId: "t1", kind: "tag", source: "inline" },
      { noteId: "n2", targetId: "t1", kind: "tag", source: "manual" },
      { noteId: "n3", targetId: "s1", kind: "space" },
    ],
  };
}

const suggestion = (noteId: string, spaceId = "s1"): SpaceSuggestion => ({
  noteId,
  noteTitle: noteId,
  spaceId,
  spaceName: "Research",
  probability: 0.8,
  reasons: [{ label: "#ideas", kind: "tag" }],
});

describe("buildGraph", () => {
  it("draws notes, tags, and Spaces that are connected, and counts the rest", () => {
    const g = buildGraph(library());
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2", "n3", "s1", "t1"]);
    expect(g.edges).toHaveLength(3);
    expect(g.unconnectedNotes).toBe(1);
  });

  it("labels each kind the way the rest of the app does", () => {
    const g = buildGraph(library());
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("t1")).toMatchObject({ kind: "tag", label: "#ideas", color: "#ff8800" });
    expect(byId.get("s1")).toMatchObject({ kind: "space", label: "Research" });
    expect(byId.get("n1")).toMatchObject({ kind: "note", label: "Alpha" });
  });

  it("sizes a tag or Space by how many notes it gathers", () => {
    const g = buildGraph(library());
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("t1")?.degree).toBe(2);
    expect(byId.get("s1")?.degree).toBe(1);
  });

  it("keeps how each tag got onto its note, for the edge style", () => {
    const g = buildGraph(library());
    const edge = (source: string) => g.edges.find((e) => e.source === source);
    expect(edge("n1")).toMatchObject({ kind: "tag", tagSource: "inline" });
    expect(edge("n2")).toMatchObject({ kind: "tag", tagSource: "manual" });
    expect(edge("n3")).toMatchObject({ kind: "space" });
    expect(edge("n3")?.tagSource).toBeUndefined();
    // A link written before sources were sent reads as added.
    const lib = library();
    delete lib.links[0].source;
    expect(buildGraph(lib).edges.find((e) => e.source === "n1")?.tagSource).toBe("manual");
  });

  it("draws a suggestion as its own edge, and the loose note it is for", () => {
    const g = buildGraph(library(), [suggestion("lone")]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["lone", "n1", "n2", "n3", "s1", "t1"]);
    expect(g.edges.find((e) => e.kind === "suggested")).toMatchObject({ source: "lone", target: "s1" });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("lone")).toMatchObject({ suggested: true, degree: 0 });
    // A Space is as big as what it holds; a suggestion does not grow it.
    expect(byId.get("s1")?.degree).toBe(1);
    expect(g.unconnectedNotes).toBe(0);
    expect(g.populatedSpaces).toBe(1);
  });

  it("drops a suggestion for a note or Space that is not drawn", () => {
    const g = buildGraph(library(), [suggestion("ghost"), suggestion("lone", "empty-space")]);
    expect(g.edges.some((e) => e.kind === "suggested")).toBe(false);
    expect(g.unconnectedNotes).toBe(1);
  });

  it("ignores a link to a note or target that is not in the graph", () => {
    const lib = library();
    lib.links.push({ noteId: "ghost", targetId: "t1", kind: "tag" });
    lib.links.push({ noteId: "n1", targetId: "missing", kind: "space" });
    expect(buildGraph(lib).edges).toHaveLength(3);
  });
});

describe("layoutGraph", () => {
  it("places the same library the same way every time", () => {
    const a = layoutGraph(buildGraph(library()));
    const b = layoutGraph(buildGraph(library()));
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
  });

  it("gives every node a finite position", () => {
    const g = layoutGraph(buildGraph(library()));
    for (const n of g.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });

  it("pulls a note toward the tag it carries, away from unrelated hubs", () => {
    const g = layoutGraph(buildGraph(library()));
    const at = new Map(g.nodes.map((n) => [n.id, n]));
    const dist = (a: string, b: string) =>
      Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
    expect(dist("n1", "t1")).toBeLessThan(dist("n1", "s1"));
  });

  it("starts nodes it has placed before where they were, so a refresh does not reshuffle", () => {
    const first = layoutGraph(buildGraph(library()));
    const previous = new Map(first.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const again = layoutGraph(buildGraph(library()), { previous, ticks: 0 });
    expect(again.nodes.map((n) => [n.x, n.y])).toEqual(first.nodes.map((n) => [n.x, n.y]));
  });
});

describe("refreshing a laid-out library", () => {
  it("keeps what was already there nearly still when one note is added", () => {
    const lib = library();
    for (let i = 0; i < 30; i++) {
      lib.notes.push(note(`m${i}`));
      lib.links.push({ noteId: `m${i}`, targetId: i % 2 ? "t1" : "s1", kind: i % 2 ? "tag" : "space" });
    }
    const first = layoutGraph(buildGraph(lib));
    const previous = new Map(first.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    lib.notes.push(note("new"));
    lib.links.push({ noteId: "new", targetId: "t1", kind: "tag" });
    const after = new Map(layoutGraph(buildGraph(lib), { previous }).nodes.map((n) => [n.id, n]));
    const moved = first.nodes.map((n) => Math.hypot(after.get(n.id)!.x - n.x, after.get(n.id)!.y - n.y));
    const mean = moved.reduce((a, b) => a + b, 0) / moved.length;
    expect(mean).toBeLessThan(4);
    // The newcomer still lands by the tag it carries.
    const newcomer = after.get("new")!;
    const hub = after.get("t1")!;
    expect(Math.hypot(newcomer.x - hub.x, newcomer.y - hub.y)).toBeLessThan(90);
  });
});

describe("startLayout", () => {
  it("settled in steps, lands exactly where a one-go layout does", () => {
    const run = startLayout(buildGraph(library()));
    let rested = false;
    let steps = 0;
    while (!rested) {
      rested = run.step(7);
      steps++;
    }
    expect(steps).toBe(Math.ceil(LAYOUT_TICKS / 7));
    expect(run.snapshot().nodes).toEqual(layoutGraph(buildGraph(library())).nodes);
  });
});

describe("neighbors", () => {
  it("is the node and everything one link away", () => {
    const g = buildGraph(library());
    expect([...neighbors(g, "t1")].sort()).toEqual(["n1", "n2", "t1"]);
    expect([...neighbors(g, "n3")].sort()).toEqual(["n3", "s1"]);
  });

  it("at two hops is the lens: a note's hubs and the notes they gather", () => {
    const g = buildGraph(library(), [suggestion("lone")]);
    expect([...neighbors(g, "n1", 2)].sort()).toEqual(["n1", "n2", "t1"]);
    // A suggested edge is a path too: the lens on n3 reaches the note
    // suggested for its Space.
    expect([...neighbors(g, "n3", 2)].sort()).toEqual(["lone", "n3", "s1"]);
  });
});
