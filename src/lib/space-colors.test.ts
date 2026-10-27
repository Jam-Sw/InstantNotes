import { describe, expect, it } from "vitest";
import {
  cssColor,
  groupSlices,
  isStoredColor,
  markerParts,
  normalizeHex,
  parseMarkerMode,
  sectorPath,
  sliceArcs,
} from "./space-colors";

describe("cssColor", () => {
  it("resolves a swatch name through the theme variable", () => {
    expect(cssColor("blue")).toBe("var(--swatch-blue)");
    expect(cssColor("grey")).toBe("var(--swatch-grey)");
  });

  it("keeps a custom hex and drops anything else", () => {
    expect(cssColor("#3a7bff")).toBe("#3a7bff");
    expect(cssColor(null)).toBeNull();
    expect(cssColor("")).toBeNull();
    expect(cssColor("chartreuse")).toBeNull();
    expect(cssColor("#fff")).toBeNull();
    expect(cssColor("red; background: url(x)")).toBeNull();
  });
});

describe("isStoredColor", () => {
  it("accepts a swatch name or lowercase #rrggbb only", () => {
    expect(isStoredColor("teal")).toBe(true);
    expect(isStoredColor("#00ff7f")).toBe(true);
    expect(isStoredColor("#00FF7F")).toBe(false);
    expect(isStoredColor(3)).toBe(false);
  });
});

describe("normalizeHex", () => {
  it("lowercases and expands what a person types", () => {
    expect(normalizeHex("#3A7BFF")).toBe("#3a7bff");
    expect(normalizeHex(" 3a7bff ")).toBe("#3a7bff");
    expect(normalizeHex("#3a7")).toBe("#33aa77");
  });

  it("rejects non-colours", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("blue")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
  });
});

describe("marker mode", () => {
  it("defaults to color and ignores junk", () => {
    expect(parseMarkerMode(undefined)).toBe("color");
    expect(parseMarkerMode("nonsense")).toBe("color");
    expect(parseMarkerMode("both")).toBe("both");
    expect(parseMarkerMode("flag")).toBe("flag");
  });

  it("draws a disc in color mode, a flag in flag mode, both in both", () => {
    expect(markerParts("color", false)).toEqual({ disc: true, flag: false });
    expect(markerParts("flag", false)).toEqual({ disc: false, flag: true });
    expect(markerParts("both", false)).toEqual({ disc: true, flag: true });
  });

  it("lets a space's own flag add the flag in any mode", () => {
    expect(markerParts("color", true)).toEqual({ disc: true, flag: true });
    expect(markerParts("flag", true)).toEqual({ disc: false, flag: true });
  });
});

describe("groupSlices", () => {
  it("groups by space and skips empty or invalid slices", () => {
    const m = groupSlices([
      { workspaceId: "a", color: "red", noteCount: 2 },
      { workspaceId: "a", color: "#00ff00", noteCount: 1 },
      { workspaceId: "b", color: "blue", noteCount: 0 },
      { workspaceId: "b", color: "nope", noteCount: 4 },
      { workspaceId: "c", color: "blue", noteCount: 5 },
    ]);
    expect(m.get("a")).toHaveLength(2);
    expect(m.has("b")).toBe(false);
    expect(m.get("c")).toHaveLength(1);
  });
});

describe("sliceArcs", () => {
  it("sizes each slice by its note count over a full turn, biggest first", () => {
    const arcs = sliceArcs([
      { color: "red", noteCount: 1 },
      { color: "blue", noteCount: 3 },
    ]);
    expect(arcs).toEqual([
      { color: "var(--swatch-blue)", start: 0, end: 270 },
      { color: "var(--swatch-red)", start: 270, end: 360 },
    ]);
  });

  it("is a single full turn for one colour", () => {
    expect(sliceArcs([{ color: "green", noteCount: 7 }])).toEqual([
      { color: "var(--swatch-green)", start: 0, end: 360 },
    ]);
  });

  it("merges tags that share a colour", () => {
    const arcs = sliceArcs([
      { color: "red", noteCount: 1 },
      { color: "red", noteCount: 1 },
      { color: "#112233", noteCount: 2 },
    ]);
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toMatchObject({ start: 0, end: 180 });
    expect(arcs[1]).toMatchObject({ start: 180, end: 360 });
  });

  it("is empty with nothing to show, and always closes exactly at 360", () => {
    expect(sliceArcs([])).toEqual([]);
    expect(sliceArcs([{ color: "red", noteCount: 0 }])).toEqual([]);
    const arcs = sliceArcs([
      { color: "red", noteCount: 1 },
      { color: "blue", noteCount: 1 },
      { color: "green", noteCount: 1 },
    ]);
    expect(arcs[arcs.length - 1].end).toBe(360);
  });
});

describe("sectorPath", () => {
  it("draws a quarter as one arc from the top to the right", () => {
    expect(sectorPath(10, 10, 10, 0, 90)).toBe("M10 10L10 0A10 10 0 0 1 20 10Z");
  });

  it("flags a reflex sector as a large arc", () => {
    expect(sectorPath(10, 10, 10, 0, 270)).toContain("A10 10 0 1 1");
  });

  it("draws a full turn as two half arcs", () => {
    const d = sectorPath(10, 10, 10, 0, 360);
    expect(d.match(/A/g)).toHaveLength(2);
  });
});
