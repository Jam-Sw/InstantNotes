import { describe, it, expect } from "vitest";
import { blockMarkerRange } from "./wysiwyg";

describe("blockMarkerRange", () => {
  it("returns null for plain text", () => {
    expect(blockMarkerRange("hello world", 0)).toBeNull();
  });

  it("detects bullet list marker (- )", () => {
    expect(blockMarkerRange("- item text", 0)).toEqual({ from: 0, to: 2 });
  });

  it("detects bullet list marker (* )", () => {
    expect(blockMarkerRange("* item text", 0)).toEqual({ from: 0, to: 2 });
  });

  it("detects bullet list marker (+ )", () => {
    expect(blockMarkerRange("+ item text", 0)).toEqual({ from: 0, to: 2 });
  });

  it("detects ordered list marker (1. )", () => {
    expect(blockMarkerRange("1. item text", 0)).toEqual({ from: 0, to: 3 });
  });

  it("detects ordered list marker (12. )", () => {
    expect(blockMarkerRange("12. item text", 0)).toEqual({ from: 0, to: 4 });
  });

  it("detects blockquote marker (> )", () => {
    expect(blockMarkerRange("> quoted text", 0)).toEqual({ from: 0, to: 2 });
  });

  it("detects bare blockquote marker (>)", () => {
    expect(blockMarkerRange(">text", 0)).toEqual({ from: 0, to: 1 });
  });

  it("accounts for lineFrom offset", () => {
    const result = blockMarkerRange("- item", 50);
    expect(result).toEqual({ from: 50, to: 52 });
  });

  it("returns null for a line starting with text that looks like a marker mid-line", () => {
    expect(blockMarkerRange("text - not a marker", 0)).toBeNull();
  });

  it("handles indented list markers", () => {
    // "  - item": indent=2, marker="-", space=1 → marker occupies [2,4), text starts at 4
    expect(blockMarkerRange("  - item", 0)).toEqual({ from: 2, to: 4 });
  });
});
