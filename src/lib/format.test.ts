import { describe, it, expect } from "vitest";
import { formatExact, formatBytes, preview, wordCount } from "./format";

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
