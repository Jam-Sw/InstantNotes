import { describe, it, expect } from "vitest";
import { preview, wordCount } from "./format";

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
