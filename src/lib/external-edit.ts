// An edit that arrives from outside the editor (an agent writing to the
// open note) lands as an ordinary CodeMirror change, not a reload: the
// caret and selection map through it, it joins the undo history (Cmd-Z
// takes the agent's edit back out), and the text it inserted flashes so
// the user sees what changed and where.

import {
  EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** How long inserted text stays highlighted. */
const FLASH_MS = 2400;

interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The one contiguous replacement that turns `before` into `after`: the
 * common prefix and suffix stay, the middle is replaced. Null when equal.
 * @internal
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < max - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

const flash = StateEffect.define<{ from: number; to: number }>();
const clearFlash = StateEffect.define<null>();
const flashMark = Decoration.mark({ class: "cm-external-flash" });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flash)) next = Decoration.set([flashMark.range(e.value.from, e.value.to)]);
      if (e.is(clearFlash)) next = Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const flashTheme = EditorView.baseTheme({
  ".cm-external-flash": {
    backgroundColor: "var(--accent-soft)",
    boxShadow: "0 0 0 1px var(--accent-soft)",
    borderRadius: "3px",
    animation: `cm-external-flash ${FLASH_MS}ms ease-out forwards`,
  },
  "@keyframes cm-external-flash": {
    "0%": { backgroundColor: "color-mix(in srgb, var(--accent) 38%, transparent)" },
    "100%": { backgroundColor: "transparent", boxShadow: "none" },
  },
});

/** The editor extension that draws the flash. */
export const externalEdit = [flashField, flashTheme];

/**
 * The transaction that brings `state` to `next`, or null if already there.
 * @internal
 */
export function externalEditSpec(state: EditorState, next: string): TransactionSpec | null {
  const change = minimalChange(state.doc.toString(), next);
  if (!change) return null;
  const end = change.from + change.insert.length;
  return {
    changes: change,
    effects: end > change.from ? flash.of({ from: change.from, to: end }) : [],
    userEvent: "external",
  };
}

/** Apply an outside edit to a live view and schedule the flash to clear. */
export function applyExternalEdit(view: EditorView, next: string): boolean {
  const spec = externalEditSpec(view.state, next);
  if (!spec) return false;
  view.dispatch(spec);
  setTimeout(() => {
    // The view may be gone (note closed) by then.
    if (view.dom.isConnected) view.dispatch({ effects: clearFlash.of(null) });
  }, FLASH_MS);
  return true;
}
