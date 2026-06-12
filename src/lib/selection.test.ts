import { describe, expect, it } from "vitest";
import { rangeSelection, stepId, toggleSelection } from "./selection";

const ids = ["a", "b", "c", "d", "e"];

describe("toggleSelection", () => {
  it("adds an id that is not selected", () => {
    expect(toggleSelection(new Set(["a"]), "c")).toEqual(new Set(["a", "c"]));
  });

  it("removes an id that is already selected", () => {
    expect(toggleSelection(new Set(["a", "c"]), "c")).toEqual(new Set(["a"]));
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    toggleSelection(input, "b");
    expect(input).toEqual(new Set(["a"]));
  });
});

describe("rangeSelection", () => {
  it("selects the inclusive range from anchor to target", () => {
    expect(rangeSelection(ids, "b", "d")).toEqual(new Set(["b", "c", "d"]));
  });

  it("selects backwards when target is above the anchor", () => {
    expect(rangeSelection(ids, "d", "a")).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("selects a single id when anchor equals target", () => {
    expect(rangeSelection(ids, "c", "c")).toEqual(new Set(["c"]));
  });

  it("falls back to the target when the anchor is missing", () => {
    expect(rangeSelection(ids, null, "c")).toEqual(new Set(["c"]));
    expect(rangeSelection(ids, "zzz", "c")).toEqual(new Set(["c"]));
  });
});

describe("stepId", () => {
  it("moves down one row", () => {
    expect(stepId(ids, "b", 1)).toBe("c");
  });

  it("moves up one row", () => {
    expect(stepId(ids, "b", -1)).toBe("a");
  });

  it("clamps at the ends of the list", () => {
    expect(stepId(ids, "a", -1)).toBe("a");
    expect(stepId(ids, "e", 1)).toBe("e");
  });

  it("starts from the first row when nothing is current", () => {
    expect(stepId(ids, null, 1)).toBe("a");
    expect(stepId(ids, "zzz", -1)).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(stepId([], null, 1)).toBeNull();
  });
});
