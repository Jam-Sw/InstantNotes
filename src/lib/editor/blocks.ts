import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { previewModeField } from "./kernel";

/** @internal */
export function blockMarkerRange(
  lineText: string,
  lineFrom: number,
): { from: number; to: number } | null {
  const m = lineText.match(/^(\s*)(>\s*|[-*+]\s+|\d+\.\s+|#{1,6}\s+)/);
  if (!m) return null;
  return { from: lineFrom + m[1].length, to: lineFrom + m[0].length };
}

export function markerBackspaceKeymap(): Extension {
  return keymap.of([
    {
      key: "Backspace",
      run(view) {
        if (!view.state.field(previewModeField)) return false;
        const sel = view.state.selection.main;
        if (!sel.empty) return false;

        const line = view.state.doc.lineAt(sel.from);
        const range = blockMarkerRange(line.text, line.from);
        if (!range || sel.from !== range.to) return false;

        view.dispatch({
          changes: { from: range.from, to: range.to, insert: "" },
        });
        return true;
      },
    },
  ]);
}
