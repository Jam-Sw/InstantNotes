import { describe, it, expect } from "vitest";
import {
  withMapEntry,
  withoutMapKeys,
  withSetEntry,
  withoutSetEntries,
} from "./reactive-collections";

describe("reactive-collections", () => {
  it("withMapEntry returns a new map with the entry set, leaving the source untouched", () => {
    const src = new Map([["a", 1]]);
    const out = withMapEntry(src, "b", 2);
    expect(out).not.toBe(src);
    expect([...out]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(src.has("b")).toBe(false);
  });

  it("withMapEntry overwrites an existing key", () => {
    expect(withMapEntry(new Map([["a", 1]]), "a", 9).get("a")).toBe(9);
  });

  it("withoutMapKeys removes every given key without touching the source", () => {
    const src = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const out = withoutMapKeys(src, ["a", "c", "missing"]);
    expect([...out]).toEqual([["b", 2]]);
    expect(src.size).toBe(3);
  });

  it("withSetEntry adds a value into a fresh set", () => {
    const src = new Set(["a"]);
    const out = withSetEntry(src, "b");
    expect(out).not.toBe(src);
    expect([...out]).toEqual(["a", "b"]);
    expect(src.has("b")).toBe(false);
  });

  it("withoutSetEntries removes every given value", () => {
    const src = new Set(["a", "b", "c"]);
    expect([...withoutSetEntries(src, ["a", "c"])]).toEqual(["b"]);
    expect(src.size).toBe(3);
  });
});
