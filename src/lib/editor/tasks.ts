import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { previewModeField } from "./kernel";

export function taskToggleChange(
  lineText: string,
  lineFrom: number,
): { from: number; to: number; insert: string } | null {
  const m = lineText.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])\]/);
  if (!m) return null;
  const at = lineFrom + m[1].length;
  return { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " };
}

export function taskChecked(markerText: string): boolean {
  return /\[[xX]\]/.test(markerText);
}

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
