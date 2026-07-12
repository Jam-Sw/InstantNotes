import { describe, it, expect } from "vitest";
import { renderTemplate, applyImageMode, DEFAULT_TEMPLATE } from "./contexting-format";

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

  it("rewrites attachment images to an absolute path when asked", () => {
    const withImg = { ...note, body: "see ![shot](attachments/a1.png)" };
    const out = renderTemplate("{content}", withImg, [], {
      imageMode: "absolute",
      attachmentsDir: "/data/attachments",
    });
    expect(out).toBe("see ![shot](/data/attachments/a1.png)");
  });
});

describe("applyImageMode", () => {
  const body = "before ![alt](attachments/x.png) after ![web](https://e.com/y.png)";

  it("keeps references untouched in keep mode", () => {
    expect(applyImageMode(body, "keep", "/d")).toBe(body);
  });

  it("rewrites only attachment refs in absolute mode", () => {
    expect(applyImageMode(body, "absolute", "/d/att")).toBe(
      "before ![alt](/d/att/x.png) after ![web](https://e.com/y.png)",
    );
  });

  it("leaves attachment refs alone in absolute mode with no dir", () => {
    expect(applyImageMode(body, "absolute", null)).toBe(body);
  });

  it("removes images in strip mode", () => {
    expect(applyImageMode("a ![x](attachments/x.png) b", "strip", null)).toBe("a  b");
  });
});
