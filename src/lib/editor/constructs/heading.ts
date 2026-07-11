// ATX heading construct: the `# ` prefix folds in preview (the heading text
// is sized by the highlight style); touching the heading line reveals it.
// Setext underlines are left alone: hiding the underline line would collapse
// it to nothing.
//
// Headings and tags coexist without ambiguity: CommonMark only parses
// `# Heading` (with a space) as a heading, and the tag construct only
// matches `#tag` (no space).

import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

export class HeadingSpec implements ConstructSpec {
  readonly nodes = ["HeaderMark"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    const parent = node.node.parent;
    if (!parent || !/^ATXHeading/.test(parent.name)) return false;
    const owner = emit.construct(parent.from, parent.to, "span");
    const after = cx.state.doc.sliceString(node.to, node.to + 1);
    emit.hide(owner, node.from, after === " " ? node.to + 1 : node.to);
    return false;
  }
}
