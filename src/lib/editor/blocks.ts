// Block markers as objects under deletion. Backspace with the caret at the
// end of a leading block marker removes the whole marker, so a bullet or
// heading prefix dies in one keystroke instead of shedding characters. The
// kernel's atomic ranges give widget markers the same treatment during
// normal cursor motion and deletion; this keymap covers the revealed ones
// (heading #, quote >) and must be registered above defaultKeymap, whose
// deleteCharBackward would otherwise always win.

import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { previewModeField } from "./kernel";

/**
 * Given a line's text and its document-start offset, returns the range
 * occupied by the block marker (including trailing whitespace), or null if
 * the line does not start with one.
 */
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
