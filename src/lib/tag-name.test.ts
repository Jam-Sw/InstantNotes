import { describe, expect, it } from "vitest";
import { normalizeTagInput } from "./tag-name";

describe("normalizeTagInput", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTagInput("  project  ")).toBe("project");
  });

  it("strips a single leading hash", () => {
    expect(normalizeTagInput("#idea")).toBe("idea");
  });

  it("strips a leading hash followed by whitespace", () => {
    expect(normalizeTagInput("# idea")).toBe("idea");
  });

  it("rejects an empty result", () => {
    expect(normalizeTagInput("")).toBeNull();
    expect(normalizeTagInput("   ")).toBeNull();
    expect(normalizeTagInput("#")).toBeNull();
    expect(normalizeTagInput("#  ")).toBeNull();
  });

  it("leaves an inner hash untouched", () => {
    expect(normalizeTagInput("c#lang")).toBe("c#lang");
  });

  it("only strips one leading hash; the server strips the rest", () => {
    expect(normalizeTagInput("##idea")).toBe("#idea");
  });
});
