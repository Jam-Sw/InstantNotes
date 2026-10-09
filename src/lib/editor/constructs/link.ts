import { Decoration } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { linkAt, linkMarkClass, linkPrefsField } from "../links";
import type { ConstructSpec, Emit, ScanContext } from "../types";

export class LinkSpec implements ConstructSpec {
  readonly nodes = ["Link", "Autolink", "URL"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (node.name === "Link") {
      const owner = emit.construct(node.from, node.to, "span");
      const raw = cx.state.doc.sliceString(node.from, node.to);
      const split = raw.indexOf("](");
      if (split !== -1) {
        emit.hide(owner, node.from, node.from + 1);
        emit.hide(owner, node.from + split, node.to);
      }
      this.#mark(node.from, node.to, cx, emit);
      return true;
    }

    if (node.name === "Autolink") {
      const owner = emit.construct(node.from, node.to, "span");
      for (let c = node.node.firstChild; c; c = c.nextSibling) {
        if (c.name === "LinkMark") emit.hide(owner, c.from, c.to);
      }
      this.#mark(node.from, node.to, cx, emit);
      return false;
    }

    const parent = node.node.parent;
    if (parent && (parent.name === "Link" || parent.name === "Autolink")) {
      return false;
    }
    this.#mark(node.from, node.to, cx, emit);
    return false;
  }

  #mark(from: number, to: number, cx: ScanContext, emit: Emit): void {
    const href = linkAt(cx.state, from);
    if (!href) return;
    const prefs = cx.state.field(linkPrefsField);
    emit.mark(
      from,
      to,
      Decoration.mark({
        class: linkMarkClass(prefs, cx.preview),
        attributes: prefs.tooltip ? { title: href } : undefined,
      }),
    );
  }
}
