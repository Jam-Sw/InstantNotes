import { describe, it, expect } from "vitest";
import { formatExact, formatBytes, preview, sheetPreview, wordCount } from "./format";

describe("preview", () => {
  it("collapses whitespace and trims", () => {
    expect(preview("  a\n\n b   c ")).toBe("a b c");
  });
  it("caps at 90 characters", () => {
    expect(preview("x".repeat(200))).toHaveLength(90);
  });
  it("is empty for blank input", () => {
    expect(preview("   \n\t ")).toBe("");
  });
  it("matches a full collapse on long bodies", () => {
    const words = Array.from({ length: 4000 }, (_, i) => `w${i}`).join("  \n ");
    const full = words.replace(/\s+/g, " ").trim().slice(0, 90);
    expect(preview(words)).toBe(full);
  });
  it("looks past a long run of leading whitespace", () => {
    const body = `${" \n".repeat(2000)}hello  world${"z ".repeat(2000)}`;
    expect(preview(body)).toBe(body.replace(/\s+/g, " ").trim().slice(0, 90));
  });
});

describe("sheetPreview", () => {
  it("lists the cells in reading order without the table's pipes and rule", () => {
    expect(sheetPreview("| Date | ms |\n| --- | --- |\n| 2026-10-03 | 412 |")).toBe(
      "Date · ms · 2026-10-03 · 412",
    );
  });
  it("unescapes pipes, flattens line breaks, skips empty cells, and caps the length", () => {
    expect(sheetPreview("| a\\|b |  | one<br>two |\n| --- | --- | --- |")).toBe("a|b · one two");
    expect(sheetPreview(`| ${"x".repeat(200)} |\n| --- |`)).toHaveLength(90);
  });
  it("is empty for an empty sheet", () => {
    expect(sheetPreview("")).toBe("");
  });
});

describe("formatExact", () => {
  it("includes the year, month, day, and minute-precise time", () => {
    // A fixed instant; assert the pieces rather than an exact locale string so
    // the test is not tied to one runtime's formatting.
    const s = formatExact("2026-07-11T14:55:00.000Z");
    const d = new Date("2026-07-11T14:55:00.000Z");
    expect(s).toContain(String(d.getFullYear()));
    expect(s).toContain(String(d.getMinutes()).padStart(2, "0"));
  });
});

describe("formatBytes", () => {
  it("is 0 B for zero or negative", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
  it("shows KB and MB with sensible precision", () => {
    expect(formatBytes(340 * 1024)).toBe("340 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
});

describe("wordCount", () => {
  it("counts whitespace-delimited words", () => {
    expect(wordCount("one two three")).toBe(3);
  });
  it("collapses runs of whitespace", () => {
    expect(wordCount("  one   two  ")).toBe(2);
  });
  it("is 0 for blank input", () => {
    expect(wordCount("   ")).toBe(0);
  });
});
