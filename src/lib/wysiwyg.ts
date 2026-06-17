// WYSIWYG preview extension for CodeMirror 6.
//
// When previewModeField is true (Aa toolbar closed), markdown syntax markers
// are hidden via replace decorations and block elements get visual treatment.
// The document stays fully editable - the raw markdown is unchanged, just
// rendered differently.

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// ---------------------------------------------------------------------------
// Mode state
// ---------------------------------------------------------------------------

export const setPreviewMode = StateEffect.define<boolean>();

export const previewModeField = StateField.define<boolean>({
  create: () => false,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setPreviewMode)) return e.value;
    }
    return val;
  },
});

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-wysiwyg-bullet";
    s.textContent = "•";
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

class NumberWidget extends WidgetType {
  constructor(readonly num: number) {
    super();
  }
  eq(o: NumberWidget) {
    return o.num === this.num;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-wysiwyg-number";
    s.textContent = `${this.num}.`;
    return s;
  }
  ignoreEvent() {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

type Deco = { from: number; to: number; deco: Decoration };

function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const collected: Deco[] = [];
  // Track lines that already have a line-deco so we don't add it twice.
  const lineDecoAdded = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const { name, from: nFrom, to: nTo } = node;

        // --- Inline: hide emphasis/strikethrough/code marks ---
        if (
          name === "EmphasisMark" ||
          name === "StrikethroughMark" ||
          name === "CodeMark"
        ) {
          collected.push({ from: nFrom, to: nTo, deco: Decoration.replace({}) });
          return false;
        }

        // --- Inline: hide link markup, keep link text visible ---
        if (name === "Link") {
          const raw = state.doc.sliceString(nFrom, nTo);
          // Find ]( which separates link text from URL
          const splitIdx = raw.indexOf("](");
          if (splitIdx !== -1) {
            // Hide opening [
            collected.push({
              from: nFrom,
              to: nFrom + 1,
              deco: Decoration.replace({}),
            });
            // Hide ](...) to end of link
            collected.push({
              from: nFrom + splitIdx,
              to: nTo,
              deco: Decoration.replace({}),
            });
          }
          return false;
        }

        // --- Block: list markers (- / * / + / 1.) ---
        if (name === "ListMark") {
          const line = state.doc.lineAt(nFrom);
          const m = line.text.match(/^(\s*)([-*+]|\d+\.)\s+/);
          if (m) {
            // markerEnd covers indent + marker char(s) + trailing space
            const markerEnd = line.from + m[0].length;
            const isOrdered = /^\d+\./.test(m[2]);
            if (isOrdered) {
              const num = parseInt(m[2], 10);
              collected.push({
                from: line.from + m[1].length, // after indent
                to: markerEnd,
                deco: Decoration.replace({ widget: new NumberWidget(num) }),
              });
            } else {
              collected.push({
                from: line.from + m[1].length,
                to: markerEnd,
                deco: Decoration.replace({ widget: new BulletWidget() }),
              });
            }
          }
          return false;
        }

        // --- Block: blockquote marker (>) ---
        if (name === "QuoteMark") {
          const line = state.doc.lineAt(nFrom);
          const m = line.text.match(/^(>\s*)/);
          if (m) {
            const markerEnd = line.from + m[0].length;
            // Line decoration for styling - add once per line
            if (!lineDecoAdded.has(line.from)) {
              lineDecoAdded.add(line.from);
              collected.push({
                from: line.from,
                to: line.from,
                deco: Decoration.line({ class: "cm-wysiwyg-blockquote" }),
              });
            }
            // Replace the > prefix
            collected.push({
              from: line.from,
              to: markerEnd,
              deco: Decoration.replace({}),
            });
          }
          return false;
        }
      },
    });
  }

  // Sort by from asc, then to asc (required by RangeSetBuilder).
  collected.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of collected) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = view.state.field(previewModeField)
        ? buildDecorations(view)
        : Decoration.none;
    }

    update(u: ViewUpdate) {
      const was = u.startState.field(previewModeField);
      const is = u.state.field(previewModeField);
      if (is) {
        if (u.docChanged || u.viewportChanged || was !== is) {
          this.decorations = buildDecorations(u.view);
        }
      } else if (was !== is) {
        this.decorations = Decoration.none;
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Smart Backspace for block elements
//
// Exported for unit testing independent of CM6.
// ---------------------------------------------------------------------------

/**
 * Given a line's text and its document-start offset, returns the range
 * occupied by the block marker (including trailing whitespace), or null if
 * the line does not start with one.
 */
export function blockMarkerRange(
  lineText: string,
  lineFrom: number,
): { from: number; to: number } | null {
  const m = lineText.match(/^(\s*)(>\s*|[-*+]\s+|\d+\.\s+)/);
  if (!m) return null;
  return { from: lineFrom + m[1].length, to: lineFrom + m[0].length };
}

const wysiwygKeymap = keymap.of([
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

// ---------------------------------------------------------------------------
// Public extension bundle
// ---------------------------------------------------------------------------

export function wysiwygExtension() {
  return [previewModeField, wysiwygPlugin, wysiwygKeymap];
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const wysiwygTheme = EditorView.baseTheme({
  ".cm-wysiwyg-bullet, .cm-wysiwyg-number": {
    color: "var(--text)",
    marginRight: "0.35em",
    userSelect: "none",
  },
  ".cm-wysiwyg-blockquote": {
    borderLeft: "3px solid var(--accent)",
    paddingLeft: "12px",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
});
