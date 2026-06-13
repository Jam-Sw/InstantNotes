// Pure command-palette logic: the Command shape, fuzzy matching, ranking, and
// recents. Kept free of store/Tauri imports so it is unit-testable on its own
// (the store-coupled registry lives in commands.ts).

export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

// Recently run command ids, most recent first. In-memory only; the palette
// surfaces these when the query is empty.
let recent: string[] = [];

export function recordRecent(id: string): void {
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, 5);
}

export function recentCommands(all: Command[]): Command[] {
  return recent
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is Command => c !== undefined);
}

/** Subsequence fuzzy match. Returns a score (lower is better) or null if the
 *  query characters do not all appear, in order, in the title. */
export function fuzzyScore(title: string, query: string): number | null {
  if (!query) return 0;
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let lastMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    // Penalize gaps between matched characters so contiguous hits rank higher.
    if (lastMatch >= 0) score += found - lastMatch - 1;
    lastMatch = found;
    ti = found + 1;
  }
  // Prefer matches that start earlier in the title.
  return score + t.indexOf(q[0]);
}

/** Filter + rank commands against a query. Empty query keeps original order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((cmd) => ({ cmd, score: fuzzyScore(cmd.title, query) }))
    .filter((x): x is { cmd: Command; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.cmd);
}
