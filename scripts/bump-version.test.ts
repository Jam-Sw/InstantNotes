import { describe, it, expect } from "vitest";
import {
  isValidVersion,
  bumpJsonVersion,
  bumpPackageVersion,
} from "./bump-version.mjs";

describe("isValidVersion", () => {
  it("accepts a three-part numeric version", () => {
    expect(isValidVersion("0.6.0")).toBe(true);
    expect(isValidVersion("12.0.34")).toBe(true);
  });
  it("rejects anything that is not x.y.z", () => {
    expect(isValidVersion("0.6")).toBe(false);
    expect(isValidVersion("v0.6.0")).toBe(false);
    expect(isValidVersion("0.6.0-beta")).toBe(false);
    expect(isValidVersion("")).toBe(false);
  });
});

describe("bumpJsonVersion", () => {
  it("rewrites the top-level version key and leaves dependency versions alone", () => {
    const pkg = [
      "{",
      '  "name": "instantnotes",',
      '  "version": "0.5.2",',
      '  "dependencies": { "@codemirror/view": "^6" }',
      "}",
    ].join("\n");
    const out = bumpJsonVersion(pkg, "0.6.0");
    expect(out).toContain('"version": "0.6.0"');
    expect(out).toContain('"@codemirror/view": "^6"');
  });
});

describe("bumpPackageVersion", () => {
  it("rewrites the named package version, not dependency versions", () => {
    const cargo = [
      "[package]",
      'name = "instantnotes"',
      'version = "0.5.2"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'tauri = { version = "2" }',
    ].join("\n");
    const out = bumpPackageVersion(cargo, "instantnotes", "0.6.0");
    expect(out).toContain('name = "instantnotes"\nversion = "0.6.0"');
    expect(out).toContain('tauri = { version = "2" }');
  });

  it("only touches the requested package, leaving siblings (e.g. the core crate) alone", () => {
    const lock = [
      "[[package]]",
      'name = "instantnotes-core"',
      'version = "0.4.0"',
      "",
      "[[package]]",
      'name = "instantnotes"',
      'version = "0.5.2"',
    ].join("\n");
    const out = bumpPackageVersion(lock, "instantnotes", "0.6.0");
    expect(out).toContain('name = "instantnotes-core"\nversion = "0.4.0"');
    expect(out).toContain('name = "instantnotes"\nversion = "0.6.0"');
  });
});
