import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { ConstructSpec, Emit, ScanContext } from "../types";

class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cm-wysiwyg-hr";
    return s;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const hrDeco = Decoration.replace({ widget: new HrWidget() });

export class HrSpec implements ConstructSpec {
  readonly nodes = ["HorizontalRule"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return false;
    const owner = emit.construct(node.from, node.to, "span");
    emit.hide(owner, node.from, node.to, hrDeco);
    return false;
  }
}
