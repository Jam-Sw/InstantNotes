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
