import { describe, it, expect } from "vitest";
import { listIndentChanges } from "./list-indent";

describe("listIndentChanges", () => {
  it("indents a single bullet line", () => {
    expect(listIndentChanges("- item", 2, 2, false)).toEqual([{ from: 0, insert: "  " }]);
  });

  it("indents ordered list items", () => {
    expect(listIndentChanges("1. first", 0, 0, false)).toEqual([{ from: 0, insert: "  " }]);
  });

  it("returns no changes for a non-list line", () => {
    expect(listIndentChanges("just a paragraph", 3, 3, false)).toEqual([]);
  });

  it("indents a line that is already nested, deeper", () => {
    expect(listIndentChanges("  - nested", 5, 5, false)).toEqual([{ from: 0, insert: "  " }]);
  });

  it("outdents an indented bullet by two spaces", () => {
    expect(listIndentChanges("  - item", 4, 4, true)).toEqual([{ from: 0, to: 2 }]);
  });

  it("does not outdent a top-level bullet", () => {
    expect(listIndentChanges("- item", 2, 2, true)).toEqual([]);
  });

  it("removes only the available leading space when outdenting one space", () => {
    expect(listIndentChanges(" - item", 3, 3, true)).toEqual([{ from: 0, to: 1 }]);
  });

  it("indents every list line a multi-line selection touches", () => {
    const doc = "- a\n- b\n- c";
    expect(listIndentChanges(doc, 0, doc.length, false)).toEqual([
      { from: 0, insert: "  " },
      { from: 4, insert: "  " },
      { from: 8, insert: "  " },
    ]);
  });

  it("skips non-list lines inside a mixed selection", () => {
    const doc = "- a\nplain\n- c";
    expect(listIndentChanges(doc, 0, doc.length, false)).toEqual([
      { from: 0, insert: "  " },
      { from: 10, insert: "  " },
    ]);
  });
});
