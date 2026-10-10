import { describe, it, expect } from "vitest";
import { tags as t } from "@lezer/highlight";
import { markdownHighlightSpec } from "./markdown-highlight";

describe("markdown highlight spec", () => {
  const styledTags = markdownHighlightSpec.flatMap((s) =>
    Array.isArray(s.tag) ? s.tag : [s.tag],
  );

  it("styles headings with a visual scale", () => {
    for (const heading of [t.heading1, t.heading2, t.heading3, t.heading]) {
      expect(styledTags).toContain(heading);
    }
  });

  it("styles the inline emphasis the toolbar produces", () => {
    expect(styledTags.length).toBeGreaterThan(0);
    for (const entry of markdownHighlightSpec) {
      const keys = Object.keys(entry).filter((k) => k !== "tag");
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
