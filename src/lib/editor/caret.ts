// CaretGuard: the only module allowed to influence selection placement.
//
// CM6's atomic ranges (wired in kernel.ts) already keep cursor MOTION and
// deletion out of folded markup. Pointer placement is the remaining gap:
// with `](url)` folded away, the DOM's last caret position on the line sits
// at the end of the visible link text, so a click in the blank space to the
// right of the line resolves just before the `]` and typing would extend the
// link. The guard detects exactly that case (everything between the resolved
// position and the end of the line is folded, and the click landed past the
// last glyph) and places the caret at the true end of the line instead:
// where the eye says it clicked.
//
// Implemented with EditorView.mouseSelectionStyle, the sanctioned hook, so
// drag selections keep working: every drag event maps through the same
// correction.

import { EditorView, type MouseSelectionStyle } from "@codemirror/view";
import { EditorSelection, type Extension } from "@codemirror/state";
import { previewModeField, type Kernel } from "./kernel";

export class CaretGuard {
  constructor(private readonly kernel: Kernel["plugin"]) {}

  extension(): Extension {
    return EditorView.mouseSelectionStyle.of((view, event) =>
      this.#style(view, event),
    );
  }

  #style(view: EditorView, event: MouseEvent): MouseSelectionStyle | null {
    // Multi-clicks are word/line selection; leave them native.
    if (event.button !== 0 || event.detail > 1) return null;
    if (!(view.state.field(previewModeField, false) ?? false)) return null;
    const start = this.#corrected(view, event);
    if (start === null) return null;
    const guard = this;
    return {
      get(cur, extend, multiple) {
        const head = guard.#corrected(view, cur) ?? guard.#natural(view, cur);
        const anchor = extend ? view.state.selection.main.anchor : start;
        const range = EditorSelection.range(anchor, head);
        if (multiple) {
          const ranges = view.state.selection.ranges;
          return EditorSelection.create([...ranges, range], ranges.length);
        }
        return EditorSelection.create([range]);
      },
      update() {},
    };
  }

  #natural(view: EditorView, e: MouseEvent): number {
    return (
      view.posAtCoords({ x: e.clientX, y: e.clientY }) ??
      view.state.selection.main.head
    );
  }

  /**
   * The position this event should place the caret at, or null when the
   * native mapping is already truthful. Foldedness is judged against the
   * selection at click time, because that is what was on screen when the
   * user aimed.
   */
  #corrected(view: EditorView, e: MouseEvent): number | null {
    const k = view.plugin(this.kernel);
    if (!k) return null;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return null;
    const line = view.state.doc.lineAt(pos);
    if (pos === line.to) return null;
    if (!k.table.allHiddenBetween(pos, line.to, view.state.selection.ranges)) {
      return null;
    }
    const rect = view.coordsAtPos(pos, -1) ?? view.coordsAtPos(pos, 1);
    if (!rect || e.clientX <= rect.right + 1) return null;
    return line.to;
  }
}
