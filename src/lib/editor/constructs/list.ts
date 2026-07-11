// List marker constructs: - / * / + render as a bullet, 1. as its number.
// These are "never" reveal: the marker stays an object. The kernel's atomic
// ranges make the caret step over it whole and backspace delete it whole
// (with markerBackspaceKeymap covering the revealed-marker cases).

import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

class BulletWidget extends WidgetType {
  // All bullets are identical; report equality so the DOM node survives
  // rebuilds instead of flickering.
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cm-wysiwyg-bullet";
    s.textContent = "•";
    return s;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class NumberWidget extends WidgetType {
  constructor(readonly num: number) {
    super();
  }
  eq(o: NumberWidget): boolean {
    return o.num === this.num;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cm-wysiwyg-number";
    s.textContent = `${this.num}.`;
    return s;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() });

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+/;

export class ListSpec implements ConstructSpec {
  readonly nodes = ["ListMark"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return false;
    const line = cx.state.doc.lineAt(node.from);
    const m = line.text.match(LIST_RE);
    if (!m) return false;
    // The marker range covers marker char(s) plus trailing space, after any
    // indent.
    const from = line.from + m[1].length;
    const to = line.from + m[0].length;
    const owner = emit.construct(from, to, "never");
    const ordered = /^\d+\./.test(m[2]);
    emit.hide(
      owner,
      from,
      to,
      ordered
        ? Decoration.replace({ widget: new NumberWidget(parseInt(m[2], 10)) })
        : bulletDeco,
    );
    return false;
  }
}
