import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type SimulationLinkDatum,
  type SimulationNodeDatum3D,
} from "d3-force-3d";
import type { LibraryGraph, SpaceSuggestion } from "$lib/api/types";

type NodeKind = "note" | "tag" | "space";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  color?: string | null;
  pinned?: boolean;
  board?: boolean;
  suggested?: boolean;
  degree: number;
  x: number;
  y: number;
  z: number;
}

type EdgeKind = "tag" | "space" | "suggested";

interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  tagSource?: "inline" | "manual" | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unconnectedNotes: number;
  populatedSpaces: number;
}

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
      z: 0,
    });
  }
  for (const [id, t] of targets) {
    if (!degree.has(id)) continue;
    nodes.push({ id, ...t, degree: degree.get(id) ?? 0, x: 0, y: 0, z: 0 });
  }
  const unconnectedNotes = lib.notes.filter((n) => !degree.has(n.id) && !suggestedFor.has(n.id)).length;
  return { nodes, edges, unconnectedNotes, populatedSpaces };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nodeRadius(n: Pick<GraphNode, "kind" | "degree">): number {
  return n.kind === "note" ? 5 : 7 + Math.min(14, Math.sqrt(n.degree) * 3);
}

type SimNode = GraphNode & SimulationNodeDatum3D;
type SimLink = SimulationLinkDatum<SimNode> & { kind: EdgeKind };

const DEPTH_SEED = 120;
const DEPTH_PULL = 0.12;

export const LAYOUT_TICKS = 300;

export interface LayoutRun {
  step(ticks: number): boolean;
  snapshot(): Graph;
}

export function startLayout(
  graph: Graph,
  previous?: Map<string, { x: number; y: number; z: number }>,
): LayoutRun {
  const nodes: SimNode[] = graph.nodes.map((n) => {
    const known = previous?.get(n.id);
    if (known) return { ...n, x: known.x, y: known.y, z: known.z };
    const h = hash(n.id);
    const angle = ((h & 0xffff) / 0x10000) * 2 * Math.PI;
    const radius = 40 + ((h >>> 16) / 0x10000) * 260;
    const depth = (hash(`${n.id}:z`) / 0x100000000 - 0.5) * 2 * DEPTH_SEED;
    return { ...n, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: depth };
  });
  const links: SimLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.kind,
  }));
  const sim = forceSimulation(nodes, 3)
    .randomSource(seeded(nodes.length))
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === "suggested" ? 80 : 46))
        .strength((l) => (l.kind === "suggested" ? 0.25 : 0.7)),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((d) => (d.kind === "note" ? -60 : -260))
        .theta(1.2),
    )
    .force("collide", forceCollide<SimNode>((d) => nodeRadius(d) + 3))
    .force("x", forceX<SimNode>(0).strength(0.04))
    .force("y", forceY<SimNode>(0).strength(0.04))
    .force("z", forceZ<SimNode>(0).strength(DEPTH_PULL))
    .stop();
  const known = previous ? graph.nodes.filter((n) => previous.has(n.id)).length : 0;
  if (known * 2 >= graph.nodes.length && known > 0) sim.alpha(0.1);
  let done = 0;
  return {
    step(ticks) {
      const n = Math.min(ticks, LAYOUT_TICKS - done);
      for (let i = 0; i < n; i++) sim.tick();
      done += n;
      return done >= LAYOUT_TICKS || nodes.length === 0 || sim.alpha() < sim.alphaMin();
    },
    snapshot() {
      return {
        ...graph,
        nodes: nodes.map(({ id, kind, label, color, pinned, board, suggested, degree, x, y, z }) => ({
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
          z: z ?? 0,
        })),
      };
    },
  };
}

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
