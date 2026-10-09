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
