import { describe, expect, it } from "vitest";
import {
  emptySurfaceDocument,
  FLOW_ENGINE_ID,
  isWhiteboardKind,
  normalizeFlowData,
  parseSurfaceDocument,
  serializeSurfaceDocument,
  starterFlowData,
  withSurfaceData,
} from "./document";

describe("surface document helpers", () => {
  it("builds a starter svelte-flow document", () => {
    const doc = emptySurfaceDocument();
    expect(doc.v).toBe(1);
    expect(doc.engine).toBe(FLOW_ENGINE_ID);
    const data = normalizeFlowData(doc.data);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });

  it("round-trips serialize and parse", () => {
    const doc = emptySurfaceDocument();
    const raw = serializeSurfaceDocument(doc);
    const again = parseSurfaceDocument(raw);
    expect(again.engine).toBe(FLOW_ENGINE_ID);
    expect(normalizeFlowData(again.data).nodes.length).toBe(
      starterFlowData().nodes.length,
    );
  });

  it("falls back to starter on invalid JSON", () => {
    expect(parseSurfaceDocument("not-json").engine).toBe(FLOW_ENGINE_ID);
    expect(parseSurfaceDocument(null).engine).toBe(FLOW_ENGINE_ID);
  });

  it("upgrades legacy shell envelopes to flow", () => {
    const raw = JSON.stringify({ v: 1, engine: "shell", data: { nodes: [] } });
    const doc = parseSurfaceDocument(raw);
    expect(doc.engine).toBe(FLOW_ENGINE_ID);
    expect(normalizeFlowData(doc.data).nodes.length).toBeGreaterThan(0);
  });

  it("withSurfaceData preserves engine and replaces payload", () => {
    const next = withSurfaceData(emptySurfaceDocument(), { nodes: [], edges: [] });
    expect(next.engine).toBe(FLOW_ENGINE_ID);
    expect(next.data).toEqual({ nodes: [], edges: [] });
  });

  it("isWhiteboardKind only accepts whiteboard", () => {
    expect(isWhiteboardKind("whiteboard")).toBe(true);
    expect(isWhiteboardKind("document")).toBe(false);
  });
});
