import { describe, expect, it } from "vitest";
import { clampLabel, nodeLabel, placeLabels } from "./labels";

describe("placeLabels", () => {
  it("draws a label under its node when there is room", () => {
    const placed = placeLabels([nodeLabel("a", "Alpha", 0, 0, 5, 1)]);
    expect(placed.get("a")).toEqual({ x: 0, y: 17 });
  });

  it("moves a label over its node when a more important one has the spot under it", () => {
    const placed = placeLabels([
      nodeLabel("note", "Shopping list", 100, 100, 5, 9),
      nodeLabel("hub", "#groceries", 104, 102, 5, 1),
    ]);
    expect(placed.get("note")).toEqual({ x: 100, y: 117 });
    expect(placed.get("hub")).toEqual({ x: 104, y: 92 });
  });

  it("leaves out a label with no free spot, keeping the more important one", () => {
    const placed = placeLabels([
      nodeLabel("low", "Shopping", 100, 100, 5, 1),
      nodeLabel("high", "Shopping", 100, 100, 5, 5),
      nodeLabel("mid", "Shopping", 100, 100, 5, 3),
    ]);
    expect([...placed.keys()].sort()).toEqual(["high", "mid"]);
  });

  it("draws every label that has room", () => {
    const placed = placeLabels([
      nodeLabel("a", "Alpha", 0, 0, 5, 1),
      nodeLabel("b", "Beta", 0, 60, 5, 1),
      nodeLabel("c", "Gamma", 200, 0, 5, 1),
    ]);
    expect([...placed.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("moves a label off another node's circle", () => {
    const placed = placeLabels([nodeLabel("a", "Alpha", 0, 0, 5, 1)], [{ x: 0, y: 17, r: 5 }]);
    expect(placed.get("a")).toEqual({ x: 0, y: -10 });
  });

  it("keeps a pinned label under its node even over another circle", () => {
    const candidate = { ...nodeLabel("a", "Alpha", 0, 0, 5, 1), pinned: true };
    const placed = placeLabels([candidate], [{ x: 0, y: 17, r: 5 }]);
    expect(placed.get("a")).toEqual({ x: 0, y: 17 });
  });

  it("leaves out a label whose every spot is on another node's circle", () => {
    const placed = placeLabels(
      [nodeLabel("a", "Alpha", 0, 0, 5, 1)],
      [
        { x: 0, y: 17, r: 5 },
        { x: 0, y: -10, r: 5 },
      ],
    );
    expect(placed.has("a")).toBe(false);
  });
});

describe("clampLabel", () => {
  it("keeps a short title whole", () => {
    expect(clampLabel("Short")).toBe("Short");
  });

  it("shortens a long title to 28 characters with an ellipsis", () => {
    expect(clampLabel("a".repeat(40))).toBe(`${"a".repeat(27)}…`);
  });
});
