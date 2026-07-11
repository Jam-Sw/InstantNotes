// Task construct: GFM `[ ]` / `[x]` markers become native checkboxes in
// preview, and completed items get a struck, dimmed treatment in both modes
// so a burn-down list reads at a glance. The checkbox is a "never" reveal
// object: it stays a checkbox, the caret steps over it, and clicking it
// toggles the underlying marker character through taskToggleChange (an
// ordinary undoable edit).

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { taskChecked, taskToggleChange } from "../tasks";
import type { ConstructSpec, Emit, ScanContext } from "../types";

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(o: CheckboxWidget): boolean {
    return o.checked === this.checked;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    // posAtDOM at click time, not a stored offset: edits elsewhere in the
    // note shift positions and a stale offset would toggle the wrong line.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const line = view.state.doc.lineAt(pos);
      const change = taskToggleChange(line.text, line.from);
      if (change) view.dispatch({ changes: change });
    });
    return box;
  }
  ignoreEvent(): boolean {
    // The widget owns its clicks; CM must not turn them into caret moves.
    return true;
  }
}

const doneMark = Decoration.mark({ class: "cm-task-done" });

export class TaskSpec implements ConstructSpec {
  readonly nodes = ["Task"];

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    const marker = node.node.getChild("TaskMarker");
    if (!marker) return false;
    const checked = taskChecked(cx.state.doc.sliceString(marker.from, marker.to));
    if (cx.preview) {
      // Swallow the trailing space too so the checkbox sits flush.
      const after = cx.state.doc.sliceString(marker.to, marker.to + 1);
      const to = after === " " ? marker.to + 1 : marker.to;
      const owner = emit.construct(marker.from, to, "never");
      emit.hide(
        owner,
        marker.from,
        to,
        Decoration.replace({ widget: new CheckboxWidget(checked) }),
      );
    }
    if (checked && node.to > marker.to) {
      emit.mark(marker.to, node.to, doneMark);
    }
    return false;
  }
}
