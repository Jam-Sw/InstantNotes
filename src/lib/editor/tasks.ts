// GFM task toggling. The checkbox widget (constructs/task.ts) and the
// edit-mode marker click below both flow through taskToggleChange, so a
// toggle is always the same one-character edit: undoable, auto-saved,
// tag-safe.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { previewModeField } from "./kernel";

/**
 * The one-character change that flips a task marker on this line, or null if
 * the line is not a task item. Pure for tests; `lineFrom` is the line's
 * document offset.
 */
export function taskToggleChange(
  lineText: string,
  lineFrom: number,
): { from: number; to: number; insert: string } | null {
  const m = lineText.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])\]/);
  if (!m) return null;
  const at = lineFrom + m[1].length;
  return { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " };
}

/** True when the marker on this task line is checked. */
export function taskChecked(markerText: string): boolean {
  return /\[[xX]\]/.test(markerText);
}

/**
 * Edit mode: clicking the raw [ ] / [x] marker toggles it, so the checkbox
 * habit works no matter which mode the note is in. Preview clicks are owned
 * by the checkbox widget itself.
 */
export function editModeTaskToggle(): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return false;
      }
      if (view.state.field(previewModeField)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const tree = syntaxTree(view.state);
      const node = tree.resolveInner(pos, 1);
      if (node.name !== "TaskMarker" || pos < node.from || pos >= node.to) {
        return false;
      }
      const line = view.state.doc.lineAt(pos);
      const change = taskToggleChange(line.text, line.from);
      if (!change) return false;
      e.preventDefault();
      view.dispatch({ changes: change });
      return true;
    },
  });
}
