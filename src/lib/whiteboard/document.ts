// Pure surface-document helpers (parse, empty, serialize). No DOM, no stores.

import type { SurfaceDocument } from "./types";

/** Default engine: Svelte Flow (native to our Svelte stack). */
export const FLOW_ENGINE_ID = "svelte-flow";

/** @deprecated Prefer FLOW_ENGINE_ID; kept so old shell rows still parse. */
export const SHELL_ENGINE_ID = "shell";

export type FlowNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  type?: string;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
};

export type FlowData = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** Starter graph so a new board is not a blank void. */
export function starterFlowData(): FlowData {
  return {
    nodes: [
      {
        id: "1",
        type: "input",
        position: { x: 80, y: 60 },
        data: { label: "Start" },
      },
      {
        id: "2",
        position: { x: 80, y: 180 },
        data: { label: "Idea" },
      },
      {
        id: "3",
        type: "output",
        position: { x: 80, y: 300 },
        data: { label: "Next" },
      },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2" },
      { id: "e2-3", source: "2", target: "3" },
    ],
  };
}

/** Empty / default surface document for a new whiteboard note. */
export function emptySurfaceDocument(engine = FLOW_ENGINE_ID): SurfaceDocument {
  return {
    v: 1,
    engine,
    data: engine === FLOW_ENGINE_ID || engine === SHELL_ENGINE_ID ? starterFlowData() : {},
  };
}

export function serializeSurfaceDocument(doc: SurfaceDocument): string {
  return JSON.stringify(doc);
}

/**
 * Parse stored surface_data. Invalid input yields a fresh starter board.
 * Legacy "shell" rows are treated as empty flow boards.
 */
export function parseSurfaceDocument(raw: string | null | undefined): SurfaceDocument {
  if (!raw || !raw.trim()) return emptySurfaceDocument();
  try {
    const parsed = JSON.parse(raw) as Partial<SurfaceDocument>;
    if (parsed && parsed.v === 1 && typeof parsed.engine === "string") {
      const engine =
        parsed.engine === SHELL_ENGINE_ID ? FLOW_ENGINE_ID : parsed.engine;
      const data = normalizeFlowData(parsed.data);
      return { v: 1, engine, data };
    }
  } catch {
    // fall through
  }
  return emptySurfaceDocument();
}

export function normalizeFlowData(raw: unknown): FlowData {
  if (!raw || typeof raw !== "object") return starterFlowData();
  const obj = raw as { nodes?: unknown; edges?: unknown };
  const nodes = Array.isArray(obj.nodes) ? (obj.nodes as FlowNode[]) : [];
  const edges = Array.isArray(obj.edges) ? (obj.edges as FlowEdge[]) : [];
  if (nodes.length === 0) return starterFlowData();
  return { nodes, edges };
}

/** Write a new engine payload into an existing envelope (or a fresh one). */
export function withSurfaceData(
  current: SurfaceDocument | null | undefined,
  data: unknown,
  engine?: string,
): SurfaceDocument {
  const base = current ?? emptySurfaceDocument(engine);
  return {
    v: 1,
    engine: engine ?? base.engine,
    data,
  };
}

export function isWhiteboardKind(kind: string | undefined | null): boolean {
  return kind === "whiteboard";
}
