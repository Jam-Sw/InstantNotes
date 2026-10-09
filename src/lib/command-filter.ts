export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  parent?: string;
  isActive?: () => boolean;
  emphasis?: boolean;
  icon?: () => string;
  prefix?: string;
  keepOpenAfterRun?: boolean;
  run: () => void | Promise<void>;
}

let recent: string[] = [];

export function recordRecent(id: string): void {
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, 5);
}

export function recentCommands(all: Command[]): Command[] {
  return recent
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is Command => c !== undefined);
}

/** @internal */
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
    if (lastMatch >= 0) score += found - lastMatch - 1;
    lastMatch = found;
    ti = found + 1;
  }
  return score + t.indexOf(q[0]);
}

export function childrenOf(commands: Command[], parent: string | null): Command[] {
  return commands.filter((c) => (c.parent ?? null) === parent);
}

/** @internal */
export function hasChildren(commands: Command[], id: string): boolean {
  return commands.some((c) => c.parent === id);
}

export function findCommand(commands: Command[], id: string | null | undefined): Command | undefined {
  return id == null ? undefined : commands.find((c) => c.id === id);
}

export type Activation =
  | { kind: "descend"; parent: string }
  | { kind: "run"; keepOpen: boolean };

export function resolveActivation(commands: Command[], cmd: Command): Activation {
  if (hasChildren(commands, cmd.id)) return { kind: "descend", parent: cmd.id };
  return { kind: "run", keepOpen: cmd.keepOpenAfterRun === true };
}

export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((cmd) => ({ cmd, score: fuzzyScore(cmd.title, query) }))
    .filter((x): x is { cmd: Command; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.cmd);
}
