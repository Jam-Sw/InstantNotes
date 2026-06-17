// Pure command-palette logic: the Command shape, fuzzy matching, ranking, and
// recents. Kept free of store/Tauri imports so it is unit-testable on its own
// (the store-coupled registry lives in commands.ts).

export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  // Id of this command's parent. Unset means top level. A command that is some
  // other command's parent acts as a folder: running it descends into its
  // children instead of invoking run(). This adjacency list is what lets the
  // palette nest arbitrarily without any depth-specific code.
  parent?: string;
  // Optional live predicate; when it returns true the row shows a check mark
  // (e.g. the active theme). Evaluated in the template so it stays reactive.
  isActive?: () => boolean;
  // Visually promote this row so it reads as a distinct control rather than one
  // of a list of like items (e.g. the light/dark toggle sitting above the theme
  // leaves — it is an action, not a theme).
  emphasis?: boolean;
  // Optional leading glyph, rendered before the title. A function so it can
  // reflect live state (e.g. a sun/moon that tracks the current variant).
  icon?: () => string;
  // When true, running this leaf leaves the palette open so the user can keep
  // applying siblings (e.g. cycling themes to preview them live), regardless of
  // whether it was run from inside its folder or matched from a search.
  keepOpenAfterRun?: boolean;
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

/** Commands at one level of the tree. `parent` of null means the top level. */
export function childrenOf(commands: Command[], parent: string | null): Command[] {
  return commands.filter((c) => (c.parent ?? null) === parent);
}

/** Whether any command lists `id` as its parent, i.e. `id` acts as a folder. */
export function hasChildren(commands: Command[], id: string): boolean {
  return commands.some((c) => c.parent === id);
}

/** Look a command up by id. Returns undefined for null or an unknown id, so it
 *  doubles as the breadcrumb-label and step-back-up resolver. */
export function findCommand(commands: Command[], id: string | null | undefined): Command | undefined {
  return id == null ? undefined : commands.find((c) => c.id === id);
}

/** What activating a command should do, given the full registry. A command with
 *  children is a folder (descend into it); otherwise it runs, and `keepOpen`
 *  decides whether the palette stays open afterwards. Pure so the palette's
 *  click/Enter handling can be unit-tested without a DOM. */
export type Activation =
  | { kind: "descend"; parent: string }
  | { kind: "run"; keepOpen: boolean };

export function resolveActivation(commands: Command[], cmd: Command): Activation {
  if (hasChildren(commands, cmd.id)) return { kind: "descend", parent: cmd.id };
  return { kind: "run", keepOpen: cmd.keepOpenAfterRun === true };
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
