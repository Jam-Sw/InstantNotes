import { describe, it, expect } from "vitest";
import { parseChangelog } from "./changelog";

const SAMPLE = `# Changelog

## [Unreleased]

## [0.8.0] - 2026-07-11

### Added
- Spaces: a place you go rather than
  a label you hunt for.
- Paste or drop an image into a note.

### Changed
- Markdown preview is more dependable.

## [0.7.0] - 2026-06-01

### Added
- The very first thing.
`;

describe("parseChangelog", () => {
  it("extracts the section for a version with its date", () => {
    const r = parseChangelog(SAMPLE, "0.8.0");
    expect(r).not.toBeNull();
    expect(r!.version).toBe("0.8.0");
    expect(r!.date).toBe("2026-07-11");
    expect(r!.sections.map((s) => s.heading)).toEqual(["Added", "Changed"]);
  });

  it("folds bullet continuation lines into one item", () => {
    const r = parseChangelog(SAMPLE, "0.8.0");
    expect(r!.sections[0].items[0]).toBe(
      "Spaces: a place you go rather than a label you hunt for.",
    );
    expect(r!.sections[0].items).toHaveLength(2);
  });

  it("stops at the next release heading", () => {
    const r = parseChangelog(SAMPLE, "0.8.0");
    // Nothing from 0.7.0 leaks in.
    const all = r!.sections.flatMap((s) => s.items).join(" ");
    expect(all).not.toContain("The very first thing");
  });

  it("returns null for a version that is not present", () => {
    expect(parseChangelog(SAMPLE, "9.9.9")).toBeNull();
  });

  it("ignores the Unreleased placeholder that has no content", () => {
    const r = parseChangelog(SAMPLE, "Unreleased");
    expect(r).not.toBeNull();
    expect(r!.sections).toHaveLength(0);
  });
});
