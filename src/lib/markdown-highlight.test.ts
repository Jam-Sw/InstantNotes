import { describe, it, expect } from "vitest";
import { markdownHighlightSpec, HEADING_TAGS } from "./markdown-highlight";

describe("markdown highlight spec", () => {
  const styledTags = markdownHighlightSpec.flatMap((s) =>
    Array.isArray(s.tag) ? s.tag : [s.tag],
  );

  it("never styles a markdown heading (# is reserved for tags)", () => {
    for (const heading of HEADING_TAGS) {
      expect(styledTags).not.toContain(heading);
    }
  });

  it("styles the inline emphasis the toolbar produces", () => {
    expect(styledTags.length).toBeGreaterThan(0);
    // Spec entries carry concrete style props (not just a bare tag).
    for (const entry of markdownHighlightSpec) {
      const keys = Object.keys(entry).filter((k) => k !== "tag");
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
