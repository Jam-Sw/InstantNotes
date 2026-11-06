import { describe, expect, it } from "vitest";
import { keepOrder, paragraphAround } from "./related";

function around(doc: string, line: number): string {
  const lines = doc.split("\n");
  return paragraphAround(lines.length, (i) => lines[i], line);
}

describe("paragraphAround", () => {
  it("extracts the paragraph around the cursor line, bounded by blank lines", () => {
    const doc = "First paragraph\nsecond line\n\nMiddle block about sourdough starter\n\nFinal note";
    expect(around(doc, 3)).toBe("Middle block about sourdough starter");
    expect(around(doc, 1)).toBe("First paragraph\nsecond line");
  });

  it("returns an empty string on a blank line or an empty document", () => {
    expect(around("Alpha\n\nBeta", 1)).toBe("");
    expect(paragraphAround(0, () => "", 0)).toBe("");
  });

  it("caps a very long paragraph", () => {
    expect(around("x".repeat(5000), 0)).toHaveLength(1200);
  });
});

describe("keepOrder", () => {
  it("keeps notes already shown in place and appends new ones", () => {
    const a = { noteId: "a", score: 1 };
    const b = { noteId: "b", score: 2 };
    const c = { noteId: "c", score: 3 };
    const fresher = { noteId: "a", score: 9 };
    expect(keepOrder([a, b], [c, fresher])).toEqual([fresher, c]);
    expect(keepOrder([], [b, a])).toEqual([b, a]);
  });
});
