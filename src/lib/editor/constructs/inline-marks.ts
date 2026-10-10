import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

export class InlineMarkSpec implements ConstructSpec {
  readonly nodes = [
    "EmphasisMark",
    "StrikethroughMark",
    "CodeMark",
    "HighlightMark",
  ];

  enter(node: SyntaxNodeRef, _cx: ScanContext, emit: Emit): boolean {
    const parent = node.node.parent;
    if (!parent) return false;
    const owner = emit.construct(parent.from, parent.to, "span");
    emit.hide(owner, node.from, node.to);
    return false;
  }
}
