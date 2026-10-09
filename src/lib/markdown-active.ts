import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface ActiveMarks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  quote: boolean;
  list: boolean;
  task: boolean;
}

export const NO_MARKS: ActiveMarks = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  quote: false,
  list: false,
  task: false,
};

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
    case "Task":
      marks.task = true;
      break;
  }
}

export function activeMarks(state: EditorState): ActiveMarks {
  const sel = state.selection.main;
  const marks: ActiveMarks = { ...NO_MARKS };
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
