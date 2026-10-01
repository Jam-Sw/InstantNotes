import { describe, expect, it } from "vitest";
import {
  boardText,
  emptyBoard,
  excalidrawFile,
  parseBoard,
  sceneFingerprint,
  serializeBoard,
  type BoardElement,
} from "./document";

const text = (id: string, x: number, y: number, t: string, extra = {}): BoardElement => ({
  id,
  type: "text",
  x,
  y,
  version: 1,
  text: t,
  ...extra,
});

describe("parseBoard", () => {
  it("round-trips a saved board", () => {
    const board = { ...emptyBoard(), elements: [text("a", 0, 0, "hi")] };
    expect(parseBoard(serializeBoard(board))).toEqual(board);
  });

  it("stores the envelope the vault reads", () => {
    const stored = JSON.parse(serializeBoard(emptyBoard()));
    expect(stored.v).toBe(1);
    expect(stored.engine).toBe("excalidraw");
    expect(stored.data.elements).toEqual([]);
  });

  it("opens a missing, broken, or other-engine board as empty", () => {
    for (const raw of [
      null,
      "",
      "not json",
      JSON.stringify({ v: 1, engine: "svelte-flow", data: { nodes: [{ id: "1" }] } }),
      JSON.stringify({ v: 1, engine: "excalidraw", data: { elements: "nope" } }),
    ]) {
      expect(parseBoard(raw).elements).toEqual([]);
    }
  });
});

describe("boardText", () => {
  it("reads text top to bottom, then left to right", () => {
    const els = [
      text("c", 0, 200, "third"),
      text("b", 300, 0, "second"),
      text("a", 0, 0, "first"),
    ];
    expect(boardText(els)).toBe("first\n\nsecond\n\nthird");
  });

  it("skips deleted elements and blank text", () => {
    const els = [
      text("a", 0, 0, "kept"),
      text("b", 0, 10, "gone", { isDeleted: true }),
      text("c", 0, 20, "   "),
      { id: "r", type: "rectangle", x: 0, y: 0, version: 1 },
    ];
    expect(boardText(els)).toBe("kept");
  });

  it("prefers the unwrapped text over the wrapped display text", () => {
    const els = [text("a", 0, 0, "a long\nline", { originalText: "a long line" })];
    expect(boardText(els)).toBe("a long line");
  });

  it("includes frame names, so a titled frame is searchable", () => {
    const els = [{ id: "f", type: "frame", x: 0, y: 0, version: 1, name: "Q3 plan" }];
    expect(boardText(els)).toBe("Q3 plan");
  });

  it("is empty for an empty board", () => {
    expect(boardText([])).toBe("");
  });
});

describe("sceneFingerprint", () => {
  const base = [text("a", 0, 0, "x"), text("b", 0, 0, "y")];

  it("is stable for the same scene", () => {
    expect(sceneFingerprint(base, {})).toBe(sceneFingerprint([...base], {}));
  });

  it("changes when any element's version changes", () => {
    const edited = [base[0], { ...base[1], version: 2 }];
    expect(sceneFingerprint(edited, {})).not.toBe(sceneFingerprint(base, {}));
  });

  it("changes when an element is added or removed", () => {
    expect(sceneFingerprint(base.slice(0, 1), {})).not.toBe(sceneFingerprint(base, {}));
  });

  it("changes when an image file is added", () => {
    expect(sceneFingerprint(base, { f1: {} })).not.toBe(sceneFingerprint(base, {}));
  });
});

describe("excalidrawFile", () => {
  it("is the standard Excalidraw file, the same one the vault writes", () => {
    const board = { ...emptyBoard(), elements: [text("a", 0, 0, "hi")] };
    const file = JSON.parse(excalidrawFile(board));
    expect(file).toEqual({
      type: "excalidraw",
      version: 2,
      source: "InstantNotes",
      elements: board.elements,
      appState: board.appState,
      files: {},
    });
  });
});
