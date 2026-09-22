// The Graph view's model: which nodes and edges to draw, and where. Pure, so
// the picture is the same on every visit: the force layout starts from
// positions seeded by each node's id and draws its jitter from a seeded
// generator, never Math.random.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { LibraryGraph } from "$lib/api/types";

export type NodeKind = "note" | "tag" | "space";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  color?: string | null;
  pinned?: boolean;
  board?: boolean;
  /** How many links touch the node; a hub's size follows it. */
  degree: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "tag" | "space";
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Live notes with no tag and no Space: real, but nothing to connect. */
  unconnectedNotes: number;
}

/** The drawable graph: every note, tag, and Space with at least one link. */
export function buildGraph(lib: LibraryGraph): Graph {
  const notes = new Map(lib.notes.map((n) => [n.id, n]));
  const targets = new Map<string, { label: string; kind: NodeKind; color?: string | null }>([
    ...lib.tags.map((t) => [t.id, { label: `#${t.name}`, kind: "tag" as const, color: t.color }] as const),
    ...lib.spaces.map((s) => [s.id, { label: s.name, kind: "space" as const }] as const),
  ]);
  const edges = lib.links
    .filter((l) => notes.has(l.noteId) && targets.has(l.targetId))
    .map((l) => ({ source: l.noteId, target: l.targetId, kind: l.kind }));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: GraphNode[] = [];
  for (const n of lib.notes) {
    if (!degree.has(n.id)) continue;
    nodes.push({
      id: n.id,
      kind: "note",
      label: n.title || "Untitled",
      pinned: n.isPinned,
      board: n.contentKind === "whiteboard",
      degree: degree.get(n.id) ?? 0,
      x: 0,
      y: 0,
    });
  }
  for (const [id, t] of targets) {
    if (!degree.has(id)) continue;
    nodes.push({ id, ...t, degree: degree.get(id) ?? 0, x: 0, y: 0 });
  }
  const unconnectedNotes = lib.notes.filter((n) => !degree.has(n.id)).length;
  return { nodes, edges, unconnectedNotes };
}

/** A 32-bit hash of a string (FNV-1a), for seeding. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A small seeded generator (mulberry32) for the simulation's jitter. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drawn radius of a node, shared with the view so collisions match. */
export function nodeRadius(n: Pick<GraphNode, "kind" | "degree">): number {
  return n.kind === "note" ? 5 : 7 + Math.min(14, Math.sqrt(n.degree) * 3);
}

type SimNode = GraphNode & SimulationNodeDatum;

/** Ticks a layout runs to reach rest. */
export const LAYOUT_TICKS = 300;

export interface LayoutRun {
  /** Advance up to `ticks` steps; true once the layout has come to rest. */
  step(ticks: number): boolean;
  /** The graph with every node where the layout has it now. */
  snapshot(): Graph;
}

/**
 * Start a force layout. Nodes placed by an earlier layout (`previous`) start
 * where they were, so a refresh after an edit moves little; new ones start at
 * a spot seeded by their id. The caller drives it with `step`, so a large
 * library can settle across animation frames instead of freezing the view.
 */
export function startLayout(
  graph: Graph,
  previous?: Map<string, { x: number; y: number }>,
): LayoutRun {
  const nodes: SimNode[] = graph.nodes.map((n) => {
    const known = previous?.get(n.id);
    if (known) return { ...n, x: known.x, y: known.y };
    const h = hash(n.id);
    const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI;
    const radius = 40 + ((h >>> 16) / 0x10000) * 260;
    return { ...n, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const links: SimulationLinkDatum<SimNode>[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  const sim = forceSimulation(nodes)
    .randomSource(seeded(nodes.length))
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(46)
        .strength(0.7),
    )
    .force("charge", forceManyBody<SimNode>().strength((d) => (d.kind === "note" ? -60 : -260)))
    .force("collide", forceCollide<SimNode>((d) => nodeRadius(d) + 3))
    .force("x", forceX<SimNode>(0).strength(0.04))
    .force("y", forceY<SimNode>(0).strength(0.04))
    .stop();
  // A refresh of a laid-out library starts cool: the known nodes are already
  // at rest, and only the newcomers need to find their place.
  const known = previous ? graph.nodes.filter((n) => previous.has(n.id)).length : 0;
  if (known * 2 >= graph.nodes.length && known > 0) sim.alpha(0.1);
  let done = 0;
  return {
    step(ticks) {
      const n = Math.min(ticks, LAYOUT_TICKS - done);
      for (let i = 0; i < n; i++) sim.tick();
      done += n;
      return done >= LAYOUT_TICKS || nodes.length === 0;
    },
    snapshot() {
      return {
        ...graph,
        nodes: nodes.map(({ id, kind, label, color, pinned, board, degree, x, y }) => ({
          id,
          kind,
          label,
          color,
          pinned,
          board,
          degree,
          x: x ?? 0,
          y: y ?? 0,
        })),
      };
    },
  };
}

/** A layout run to rest in one go (`ticks: 0` gives the starting positions). */
export function layoutGraph(
  graph: Graph,
  options: { previous?: Map<string, { x: number; y: number }>; ticks?: number } = {},
): Graph {
  const run = startLayout(graph, options.previous);
  run.step(options.ticks ?? LAYOUT_TICKS);
  return run.snapshot();
}

/** A node and everything one link away from it. */
export function neighbors(graph: Graph, id: string): Set<string> {
  const out = new Set([id]);
  for (const e of graph.edges) {
    if (e.source === id) out.add(e.target);
    if (e.target === id) out.add(e.source);
  }
  return out;
}
