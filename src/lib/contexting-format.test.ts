import { describe, it, expect } from "vitest";
import { renderTemplate, applyImageMode, DEFAULT_TEMPLATE, renderContext, sourceLine, joinContexts } from "./contexting-format";

const note = { id: "01J9ZK4Q6V7W8X9Y0A1B2C3D4E", title: "Groceries", body: "milk\neggs", updatedAt: "2026-06-18T10:00:00.000Z" };

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

  const linked = "![shot](/Users/jam/Pictures/shot.png)";
  const copied = "![alt](attachments/x.png)";
  const both = `${linked} and ${copied}`;

  it("leaves a linked image untouched in keep mode", () => {
    expect(applyImageMode(linked, "keep", "/d/att")).toBe(linked);
  });

  it("leaves a linked image untouched in absolute mode", () => {
    expect(applyImageMode(linked, "absolute", "/d/att")).toBe(linked);
  });

  it("strips a linked image the same as a copied one", () => {
    expect(applyImageMode(linked, "strip", null)).toBe("");
  });

  it("a note with both a linked and a copied image: absolute mode rewrites only the copied one", () => {
    expect(applyImageMode(both, "absolute", "/d/att")).toBe(
      `${linked} and ![alt](/d/att/x.png)`,
    );
  });

  it("a note with both a linked and a copied image: strip mode removes both", () => {
    expect(applyImageMode(both, "strip", null)).toBe(" and ");
  });
});

describe("provenance", () => {
  const at = new Date(2026, 9, 15, 14, 30);

  it("fills {id} with the note id and {copied} with the copy time", () => {
    expect(renderTemplate("{id}|{copied}", note, [], { copiedAt: at })).toBe(
      `${note.id}|${at.toLocaleString()}`,
    );
  });

  it("appends the source line by default, carrying exactly Note.id", () => {
    const out = renderContext("{title}", note, [], { copiedAt: at });
    expect(out).toBe(`Groceries\n\nFrom InstantNotes ${at.toLocaleString()} · id ${note.id}`);
    const footerId = out.split("\n").at(-1)!.split(" · id ")[1];
    expect(footerId).toBe(note.id);
  });

  it("leaves the source line off when the setting is off", () => {
    expect(renderContext("{title}", note, [], { copiedAt: at, addSourceLine: false })).toBe(
      "Groceries",
    );
  });

  it("starts with From InstantNotes, then the time, then the id", () => {
    expect(sourceLine({ id: "abc" }, at)).toBe(`From InstantNotes ${at.toLocaleString()} · id abc`);
  });

  it("joins several notes as separate blocks in order", () => {
    expect(joinContexts(["a", "b"])).toBe("a\n\nb");
  });
});
