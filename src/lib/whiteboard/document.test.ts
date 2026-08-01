import { describe, expect, it } from "vitest";
import {
  emptySurfaceDocument,
  isWhiteboardKind,
  parseSurfaceDocument,
  serializeSurfaceDocument,
  withSurfaceData,
} from "./document";
import { SHELL_ENGINE_ID } from "./types";

describe("surface document helpers", () => {
  it("builds an empty shell document", () => {
    const doc = emptySurfaceDocument();
    expect(doc.v).toBe(1);
    expect(doc.engine).toBe(SHELL_ENGINE_ID);
    expect(doc.data).toEqual({ nodes: [] });
  });

  it("round-trips serialize and parse", () => {
    const doc = emptySurfaceDocument();
    const raw = serializeSurfaceDocument(doc);
    expect(parseSurfaceDocument(raw)).toEqual(doc);
  });

  it("falls back to empty shell on invalid JSON", () => {
    expect(parseSurfaceDocument("not-json").engine).toBe(SHELL_ENGINE_ID);
    expect(parseSurfaceDocument(null).engine).toBe(SHELL_ENGINE_ID);
    expect(parseSurfaceDocument("").engine).toBe(SHELL_ENGINE_ID);
  });

  it("withSurfaceData preserves engine and replaces payload", () => {
    const next = withSurfaceData(emptySurfaceDocument(), { nodes: [{ id: "a" }] });
    expect(next.engine).toBe(SHELL_ENGINE_ID);
    expect(next.data).toEqual({ nodes: [{ id: "a" }] });
  });

  it("isWhiteboardKind only accepts whiteboard", () => {
    expect(isWhiteboardKind("whiteboard")).toBe(true);
    expect(isWhiteboardKind("document")).toBe(false);
    expect(isWhiteboardKind(undefined)).toBe(false);
  });
});
