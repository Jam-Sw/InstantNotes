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
import type { LibraryGraph, SpaceSuggestion } from "$lib/api/types";

type NodeKind = "note" | "tag" | "space";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  color?: string | null;
  pinned?: boolean;
  board?: boolean;
  /** A note drawn only because a Space is suggested for it: it has no tag
   *  and no Space of its own yet. */
  suggested?: boolean;
  /** How many memberships touch the node; a hub's size follows it.
   *  Suggestions do not count: a Space is as big as what it holds. */
  degree: number;
  x: number;
  y: number;
}

/** What an edge is: a tag the note carries, a Space it is in, or a Space
 *  the model suggests for it. A tag edge also says how the tag got there. */
type EdgeKind = "tag" | "space" | "suggested";

interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  /** For a tag edge: written in the text (`inline`) or added (`manual`). */
  tagSource?: "inline" | "manual" | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Live notes with no tag, no Space, and no suggestion: real, but nothing
   *  to connect. */
  unconnectedNotes: number;
  /** How many Spaces hold at least one note. Suggestions start at two. */
  populatedSpaces: number;
}

/**
 * The drawable graph: every note, tag, and Space with at least one link,
 * plus a dashed edge for each suggestion whose note and Space are drawn.
 * A note with nothing but a suggestion is drawn for it; the caller passes
 * only the suggestions it shows, so the canvas matches the panel.
 */
export function buildGraph(lib: LibraryGraph, suggestions: SpaceSuggestion[] = []): Graph {
  const notes = new Map(lib.notes.map((n) => [n.id, n]));
  const targets = new Map<string, { label: string; kind: NodeKind; color?: string | null }>([
    ...lib.tags.map((t) => [t.id, { label: `#${t.name}`, kind: "tag" as const, color: t.color }] as const),
    ...lib.spaces.map((s) => [s.id, { label: s.name, kind: "space" as const }] as const),
  ]);
  const edges: GraphEdge[] = lib.links
    .filter((l) => notes.has(l.noteId) && targets.has(l.targetId))
    .map((l) => ({
      source: l.noteId,
      target: l.targetId,
      kind: l.kind,
      tagSource: l.kind === "tag" ? (l.source ?? "manual") : undefined,
    }));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const populatedSpaces = lib.spaces.filter((s) => degree.has(s.id)).length;

  const suggestedFor = new Set<string>();
  for (const s of suggestions) {
    if (!notes.has(s.noteId) || !degree.has(s.spaceId)) continue;
    edges.push({ source: s.noteId, target: s.spaceId, kind: "suggested" });
    suggestedFor.add(s.noteId);
  }

  const nodes: GraphNode[] = [];
  for (const n of lib.notes) {
    const own = degree.get(n.id) ?? 0;
    if (own === 0 && !suggestedFor.has(n.id)) continue;
    nodes.push({
      id: n.id,
      kind: "note",
      label: n.title || "Untitled",
      pinned: n.isPinned,
      board: n.contentKind === "whiteboard",
      suggested: own === 0 ? true : undefined,
      degree: own,
      x: 0,
      y: 0,
    });
  }
  for (const [id, t] of targets) {
    if (!degree.has(id)) continue;
    nodes.push({ id, ...t, degree: degree.get(id) ?? 0, x: 0, y: 0 });
  }
  const unconnectedNotes = lib.notes.filter((n) => !degree.has(n.id) && !suggestedFor.has(n.id)).length;
  return { nodes, edges, unconnectedNotes, populatedSpaces };
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
type SimLink = SimulationLinkDatum<SimNode> & { kind: EdgeKind };

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
 * A suggested edge pulls gently and from further out: the note hovers near
 * the Space it may join without sitting among its members.
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
  const links: SimLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.kind,
  }));
  const sim = forceSimulation(nodes)
    .randomSource(seeded(nodes.length))
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === "suggested" ? 80 : 46))
        .strength((l) => (l.kind === "suggested" ? 0.25 : 0.7)),
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
        nodes: nodes.map(({ id, kind, label, color, pinned, board, suggested, degree, x, y }) => ({
          id,
          kind,
          label,
          color,
          pinned,
          board,
          suggested,
          degree,
          x: x ?? 0,
          y: y ?? 0,
        })),
      };
    },
  };
}

/**
 * A node and everything within `hops` links of it, suggested edges included.
 * One hop is a note's own tags and Spaces; two is the lens the view opens
 * on: those, and the other notes they gather.
 */
export function neighbors(graph: Graph, id: string, hops = 1): Set<string> {
  const out = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops && frontier.length > 0; h++) {
    const next: string[] = [];
    const current = new Set(frontier);
    for (const e of graph.edges) {
      if (current.has(e.source) && !out.has(e.target)) {
        out.add(e.target);
        next.push(e.target);
      }
      if (current.has(e.target) && !out.has(e.source)) {
        out.add(e.source);
        next.push(e.source);
      }
    }
    frontier = next;
  }
  return out;
}
