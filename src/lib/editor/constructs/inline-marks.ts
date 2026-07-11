// Inline mark constructs: **bold**, *italic*, ~~strike~~, `code`, and
// ==highlight== markers fold away in preview; the styled text (painted by
// markdown-highlight.ts) stays. The construct span is the whole parent, so
// touching any part of **bold** reveals both markers together.

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
