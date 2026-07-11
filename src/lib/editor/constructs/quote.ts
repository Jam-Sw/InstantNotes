// Blockquote construct: quoted lines get the accent border treatment and
// the `>` prefix folds per line. The construct span is the line, not the
// whole quote, so a long quote does not flicker open as the caret crosses
// one of its lines.

import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

const quoteLine = Decoration.line({ class: "cm-wysiwyg-blockquote" });

const QUOTE_RE = /^(>\s*)/;

export class QuoteSpec implements ConstructSpec {
  readonly nodes = ["QuoteMark"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return false;
    const line = cx.state.doc.lineAt(node.from);
    const m = line.text.match(QUOTE_RE);
    if (!m) return false;
    emit.line(line.from, quoteLine);
    const owner = emit.construct(line.from, line.to, "span");
    emit.hide(owner, line.from, line.from + m[0].length);
    return false;
  }
}
