// Table construct: tables read as tables in preview. Monospace lines so
// columns align, bold header row, dimmed delimiter row. Structure only; the
// pipes stay, because a full grid rebuild would fight the caret.

import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

const tableLine = Decoration.line({ class: "cm-wysiwyg-table" });
const headMark = Decoration.mark({ class: "cm-wysiwyg-tablehead" });
const delimMark = Decoration.mark({ class: "cm-wysiwyg-tabledelim" });

export class TableSpec implements ConstructSpec {
  readonly nodes = ["Table", "TableHeader", "TableDelimiter"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return false;
    if (node.name === "Table") {
      const doc = cx.state.doc;
      const first = doc.lineAt(node.from).number;
      const last = doc.lineAt(node.to).number;
      for (let ln = first; ln <= last; ln++) {
        emit.line(doc.line(ln).from, tableLine);
      }
      return true;
    }
    emit.mark(node.from, node.to, node.name === "TableHeader" ? headMark : delimMark);
    return false;
  }
}
