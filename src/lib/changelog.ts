// Pure parser for the bundled CHANGELOG.md, so the Settings dashboard can show
// "what's new" for the installed version without a network call (the webview
// CSP blocks external fetches). Kept free of the raw import so it stays
// unit-testable; the component supplies the markdown via Vite's `?raw`.
//
// Expected shape (Keep a Changelog):
//   ## [0.8.0] - 2026-07-11
//   ### Added
//   - a bullet
//     continued onto the next line
//   ### Changed
//   - ...

export interface ChangelogSection {
  /** "Added", "Changed", "Fixed", etc. */
  heading: string;
  /** One entry per bullet, continuation lines folded in. */
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  /** The date after the version, or null when the heading carries none. */
  date: string | null;
  sections: ChangelogSection[];
}

const RELEASE_RE = /^##\s+\[([^\]]+)\]\s*(?:-\s*(.+))?\s*$/;
const SECTION_RE = /^###\s+(.+?)\s*$/;
const BULLET_RE = /^[-*]\s+(.+)$/;

/**
 * Extract the release block for `version` (matched exactly against the text in
 * the `## [..]` heading). Returns null when that version is not present.
 */
export function parseChangelog(md: string, version: string): ChangelogRelease | null {
  const lines = md.split("\n");
  let i = 0;

  // Find the target release heading.
  let release: ChangelogRelease | null = null;
  for (; i < lines.length; i++) {
    const m = lines[i].match(RELEASE_RE);
    if (m && m[1].trim() === version) {
      release = { version, date: m[2]?.trim() || null, sections: [] };
      i++;
      break;
    }
  }
  if (!release) return null;

  let section: ChangelogSection | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    // The next release heading ends this block.
    if (RELEASE_RE.test(line)) break;

    const sec = line.match(SECTION_RE);
    if (sec) {
      section = { heading: sec[1], items: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      // Bullets before any `###` fall under an unnamed section so nothing is
      // silently dropped.
      if (!section) {
        section = { heading: "", items: [] };
        release.sections.push(section);
      }
      section.items.push(bullet[1].trim());
      continue;
    }

    // A non-blank, non-bullet line indented under the current bullet is a
    // continuation; fold it into the last item.
    if (section && section.items.length > 0 && line.trim() !== "") {
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    }
  }

  // Drop empty sections (a `###` with no bullets carries nothing to show).
  release.sections = release.sections.filter((s) => s.items.length > 0);
  return release;
}
