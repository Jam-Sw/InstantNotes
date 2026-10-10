export interface IndentChange {
  from: number;
  to?: number;
  insert?: string;
}

const INDENT = "  ";

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+/;

export function listIndentChanges(
  doc: string,
  from: number,
  to: number,
  outdent: boolean,
): IndentChange[] {
  const blockStart = doc.lastIndexOf("\n", from - 1) + 1;
  const nextNl = doc.indexOf("\n", to);
  const blockEnd = nextNl === -1 ? doc.length : nextNl;

  const changes: IndentChange[] = [];
  let lineStart = blockStart;
  for (const line of doc.slice(blockStart, blockEnd).split("\n")) {
    const m = LIST_RE.exec(line);
    if (m) {
      if (!outdent) {
        changes.push({ from: lineStart, insert: INDENT });
      } else {
        const remove = Math.min(INDENT.length, m[1].length);
        if (remove > 0) changes.push({ from: lineStart, to: lineStart + remove });
      }
    }
    lineStart += line.length + 1;
  }
  return changes;
}
