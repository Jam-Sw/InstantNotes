interface ChangelogSection {
  heading: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

const RELEASE_RE = /^##\s+\[([^\]]+)\]\s*(?:-\s*(.+))?\s*$/;
const SECTION_RE = /^###\s+(.+?)\s*$/;
const BULLET_RE = /^[-*]\s+(.+)$/;

export function parseChangelog(md: string, version: string): ChangelogRelease | null {
  const lines = md.split(/\r?\n/);
  let i = 0;

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
    if (RELEASE_RE.test(line)) break;

    const sec = line.match(SECTION_RE);
    if (sec) {
      section = { heading: sec[1], items: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      if (!section) {
        section = { heading: "", items: [] };
        release.sections.push(section);
      }
      section.items.push(bullet[1].trim());
      continue;
    }

    if (section && section.items.length > 0 && line.trim() !== "") {
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    }
  }

  release.sections = release.sections.filter((s) => s.items.length > 0);
  return release;
}
