import { describe, it, expect } from "vitest";
import { renderTemplate, DEFAULT_TEMPLATE } from "./contexting-format";

const note = { title: "Groceries", body: "milk\neggs", updatedAt: "2026-06-18T10:00:00.000Z" };

describe("renderTemplate", () => {
  it("fills title and content", () => {
    expect(renderTemplate('<n title="{title}">{content}</n>', note, [])).toBe(
      '<n title="Groceries">milk\neggs</n>',
    );
  });

  it("renders tags as space-separated hashtags", () => {
    expect(renderTemplate("{tags}", note, [{ name: "food" }, { name: "todo" }])).toBe("#food #todo");
  });

  it("renders empty tags as an empty string", () => {
    expect(renderTemplate("[{tags}]", note, [])).toBe("[]");
  });

  it("falls back to Untitled for an empty title", () => {
    expect(renderTemplate("{title}", { ...note, title: "" }, [])).toBe("Untitled");
  });

  it("fills a non-empty date", () => {
    expect(renderTemplate("{date}", note, []).length).toBeGreaterThan(0);
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("{title} {unknown}", note, [])).toBe("Groceries {unknown}");
  });

  it("default template wraps content and metadata", () => {
    const out = renderTemplate(DEFAULT_TEMPLATE, note, [{ name: "food" }]);
    expect(out).toContain('<note title="Groceries">');
    expect(out).toContain("tags: #food");
    expect(out).toContain("milk\neggs");
    expect(out).toContain("</note>");
  });
});
