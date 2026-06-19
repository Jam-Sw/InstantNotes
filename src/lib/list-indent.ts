// Pure list-indentation helper for the editor's Tab / Shift+Tab keys. Computes
// the change set that nests (Tab) or un-nests (Shift+Tab) every list line a
// selection touches, anchored at line starts so CodeMirror remaps the selection
// for us. Kept free of CodeMirror types so it is testable against a plain string.

/** One CodeMirror-style change: insert at `from`, or delete the range [from, to). */
export interface IndentChange {
  from: number;
  to?: number;
  insert?: string;
}

/** Two spaces per indent level, matching the editor's existing list markers. */
const INDENT = "  ";

/** A bullet (-, *, +) or ordered (1.) marker with its leading whitespace. */
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+/;

/**
 * Indent (`outdent` false) or outdent (`outdent` true) every list line the range
 * [from, to] touches, by one level. Non-list lines in the range are left alone.
 * Returns an empty array when no touched line is an indentable list item, so the
 * caller can fall back to the default Tab behaviour.
 */
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
    lineStart += line.length + 1; // + 1 for the newline that split() dropped
  }
  return changes;
}
