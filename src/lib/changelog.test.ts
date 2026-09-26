import { describe, it, expect } from "vitest";
import { parseChangelog } from "./changelog";
import changelogRaw from "../../CHANGELOG.md?raw";
import pkg from "../../package.json";

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

// 0.9.0 sits undated in the real changelog until the release is cut.
const UNDATED = `# Changelog

## [Unreleased]

## [0.9.0]

### Added
- A dashboard on the Settings front page.

## [0.8.0] - 2026-07-11

### Added
- Spaces.
`;

// Force CRLF whatever the input already has. On a Windows checkout the bundled
// CHANGELOG.md arrives as CRLF, so replacing "\n" alone would make it "\r\r\n"
// and test something no checkout produces. Template literals in this file are
// always LF: the language normalizes line endings inside them when parsing.
const toCRLF = (s: string) => s.replace(/\r?\n/g, "\r\n");

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

  // A release is undated for its whole pre-release life: the date is written
  // when it is cut. The dashboard shows that section the entire time, so an
  // undated heading has to parse like any other.
  it("reads a release heading that carries no date", () => {
    const r = parseChangelog(UNDATED, "0.9.0");
    expect(r).not.toBeNull();
    expect(r!.date).toBeNull();
    expect(r!.sections).toEqual([
      { heading: "Added", items: ["A dashboard on the Settings front page."] },
    ]);
  });

  it("stops an undated release at the dated one below it", () => {
    const r = parseChangelog(UNDATED, "0.9.0");
    expect(r!.sections.flatMap((s) => s.items).join(" ")).not.toContain("Spaces");
  });

  // A Windows checkout converts the file to CRLF, so the parser sees a trailing
  // \r on every line. `.` does not match \r and the bullet pattern has no `\s*`
  // before its `$`, so splitting on "\n" alone dropped every item and the
  // dashboard showed an empty "What's new" on Windows only.
  it("parses a CRLF changelog the same as an LF one", () => {
    const lf = parseChangelog(SAMPLE, "0.8.0");
    const crlf = parseChangelog(toCRLF(SAMPLE), "0.8.0");
    expect(crlf).toEqual(lf);
    expect(crlf!.sections[0].items[0]).toBe(
      "Spaces: a place you go rather than a label you hunt for.",
    );
  });

  it("finds the running version's section in a CRLF copy of the bundled file", () => {
    const r = parseChangelog(toCRLF(changelogRaw), pkg.version);
    expect(r).not.toBeNull();
    expect(r!.sections.length).toBeGreaterThan(0);
  });

  // The bundled file is the input the dashboard actually parses, and the
  // version the app reports is the section it looks for. If a release is cut
  // without a changelog entry, "What's new" silently disappears; this fails
  // instead.
  it("finds a section for the running version in the bundled changelog", () => {
    const r = parseChangelog(changelogRaw, pkg.version);
    expect(r).not.toBeNull();
    expect(r!.sections.length).toBeGreaterThan(0);
  });
});
