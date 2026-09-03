import { describe, expect, it } from "vitest";
import {
  emptyScene,
  emptySurfaceDocument,
  EXCALIDRAW_ENGINE_ID,
  isWhiteboardKind,
  normalizeScene,
  parseSurfaceDocument,
  serializeSurfaceDocument,
  withSurfaceData,
} from "./document";

describe("surface document helpers", () => {
  it("starts empty freeform, not a starter graph", () => {
    const doc = emptySurfaceDocument();
    expect(doc.engine).toBe(EXCALIDRAW_ENGINE_ID);
    expect(normalizeScene(doc.data).elements).toEqual([]);
  });

  it("round-trips serialize and parse", () => {
    const doc = emptySurfaceDocument();
    const scene = {
      elements: [{ id: "a", type: "rectangle" }],
      appState: {},
      files: {},
    };
    const withEls = withSurfaceData(doc, scene, EXCALIDRAW_ENGINE_ID);
    const again = parseSurfaceDocument(serializeSurfaceDocument(withEls));
    expect(again.engine).toBe(EXCALIDRAW_ENGINE_ID);
    expect(normalizeScene(again.data).elements).toHaveLength(1);
  });

  it("falls back to empty on invalid JSON", () => {
    expect(parseSurfaceDocument("not-json").engine).toBe(EXCALIDRAW_ENGINE_ID);
    expect(normalizeScene(parseSurfaceDocument(null).data).elements).toEqual([]);
  });

  it("opens a blank board for legacy shell/flow rows", () => {
    const shell = JSON.stringify({ v: 1, engine: "shell", data: { nodes: [] } });
    const flow = JSON.stringify({
      v: 1,
      engine: "svelte-flow",
      data: { nodes: [{ id: "1" }], edges: [] },
    });
    expect(parseSurfaceDocument(shell).engine).toBe(EXCALIDRAW_ENGINE_ID);
    expect(normalizeScene(parseSurfaceDocument(shell).data).elements).toEqual([]);
    expect(normalizeScene(parseSurfaceDocument(flow).data).elements).toEqual([]);
  });

  it("emptyScene has no elements", () => {
    expect(emptyScene().elements).toEqual([]);
  });

  it("isWhiteboardKind only accepts whiteboard", () => {
    expect(isWhiteboardKind("whiteboard")).toBe(true);
    expect(isWhiteboardKind("document")).toBe(false);
  });
});
