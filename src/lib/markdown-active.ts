// Which inline/block marks the caret or selection currently sits inside, so the
// format toolbar can light up what's applied (active states follow the cursor).
// Tree-driven, not text-driven: the markdown parser resolves marker overlap
// (e.g. ***bold italic***) correctly, which a marker-scan cannot. Pure over an
// EditorState, so it is unit-testable without a live view.

import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface ActiveMarks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  quote: boolean;
  list: boolean;
}

export const NO_MARKS: ActiveMarks = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  quote: false,
  list: false,
};

// Lezer-markdown node names → the toolbar mark they represent.
function mark(name: string, marks: ActiveMarks): void {
  switch (name) {
    case "StrongEmphasis":
      marks.bold = true;
      break;
    case "Emphasis":
      marks.italic = true;
      break;
    case "InlineCode":
      marks.code = true;
      break;
    case "Strikethrough":
      marks.strike = true;
      break;
    case "Blockquote":
      marks.quote = true;
      break;
    case "BulletList":
    case "OrderedList":
    case "ListItem":
      marks.list = true;
      break;
  }
}

/**
 * Marks active at the current selection. Resolves the syntax tree at both
 * selection ends, from both sides, and unions every enclosing mark — so a caret
 * just inside a span, or a selection that exactly covers one, both register.
 */
export function activeMarks(state: EditorState): ActiveMarks {
  const sel = state.selection.main;
  const marks: ActiveMarks = { ...NO_MARKS };
  // Force a parse up to the selection (cheap for note-sized docs); fall back to
  // whatever is parsed if the budget lapses, rather than reporting nothing.
  const upto = Math.max(sel.from, sel.to);
  const tree = ensureSyntaxTree(state, upto, 50) ?? syntaxTree(state);

  for (const pos of new Set([sel.from, sel.to])) {
    for (const side of [-1, 1] as const) {
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
        pos,
        side,
      );
      while (node) {
        mark(node.name, marks);
        node = node.parent;
      }
    }
  }
  return marks;
}
