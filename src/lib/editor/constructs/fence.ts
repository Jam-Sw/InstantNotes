// Code fence construct: block chrome on every fence line, the backtick
// fence marks fold, and the language word stays as a small label. Touching
// the fence reveals the backticks; the chrome stays either way, so the block
// reads as a block even while being edited.

import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

const codeblockLine = Decoration.line({ class: "cm-wysiwyg-codeblock" });
const codeinfoMark = Decoration.mark({ class: "cm-wysiwyg-codeinfo" });

export class FenceSpec implements ConstructSpec {
  readonly nodes = ["FencedCode"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return false;
    const doc = cx.state.doc;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    for (let ln = first; ln <= last; ln++) {
      emit.line(doc.line(ln).from, codeblockLine);
    }
    const owner = emit.construct(node.from, node.to, "span");
    for (let c = node.node.firstChild; c; c = c.nextSibling) {
      if (c.name === "CodeMark") {
        emit.hide(owner, c.from, c.to);
      } else if (c.name === "CodeInfo") {
        emit.mark(c.from, c.to, codeinfoMark);
      }
    }
    return false;
  }
}
