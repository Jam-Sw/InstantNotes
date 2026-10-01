// Link preferences, URL resolution, and click-to-open routing.
//
// Interaction contract (user-tunable via the Links settings, carried in
// linkPrefsField): in preview mode (Aa toolbar closed) a plain click opens
// the link unless the user opted for Cmd/Ctrl+click everywhere. With the
// toolbar open the document is raw markdown being edited, so opening always
// requires Cmd/Ctrl+click and a plain click just places the caret.
//
// Appearance marks are emitted by constructs/link.ts from the same prefs, so
// the pointer cursor, underline, tooltip, and open target cannot disagree.

import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { previewModeField } from "./kernel";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** How a link opens in preview mode ("click") or only ever with Cmd/Ctrl. */
export type LinkOpenWith = "click" | "modclick";
export type LinkUnderline = "always" | "hover" | "never";

export interface LinkPrefsSnapshot {
  openWith: LinkOpenWith;
  underline: LinkUnderline;
  /** Show the destination as a hover tooltip (the URL is hidden in preview). */
  tooltip: boolean;
  /** Trailing arrow indicator so outbound links read as "leaves the app". */
  externalIndicator: boolean;
}

export const DEFAULT_LINK_PREFS: LinkPrefsSnapshot = {
  openWith: "click",
  underline: "always",
  tooltip: true,
  externalIndicator: false,
};

export const setLinkPrefs = StateEffect.define<LinkPrefsSnapshot>();

export const linkPrefsField = StateField.define<LinkPrefsSnapshot>({
  create: () => DEFAULT_LINK_PREFS,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinkPrefs)) return e.value;
    }
    return val;
  },
});

// ---------------------------------------------------------------------------
// URL resolution (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Restrict opening to schemes that are safe to hand to the OS opener. Bare
 * `www.` URLs (GFM autolinks carry no scheme) get https prepended so the
 * opener does not reject them.
 */
export function normalizeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return null;
}

/**
 * The href of the link enclosing `pos`, or null when the position is not on
 * a link. The right boundary is exclusive so a click in the whitespace after
 * a link (which resolves to the link's end position) does not open it.
 */
export function linkAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side);
    while (node) {
      if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") {
        if (pos < node.from || pos >= node.to) return null;
        const url = node.getChild("URL");
        return url ? normalizeHref(state.doc.sliceString(url.from, url.to)) : null;
      }
      if (node.name === "URL") {
        if (pos < node.from || pos >= node.to) return null;
        return normalizeHref(state.doc.sliceString(node.from, node.to));
      }
      node = node.parent;
    }
  }
  return null;
}

/** CSS classes for a link mark under the given prefs/mode. Pure for tests. */
export function linkMarkClass(prefs: LinkPrefsSnapshot, preview: boolean): string {
  let cls = `cm-link-target cm-link-ul-${prefs.underline}`;
  if (preview && prefs.openWith === "click") cls += " cm-link-clickable";
  if (prefs.externalIndicator) cls += " cm-link-ext";
  return cls;
}

// ---------------------------------------------------------------------------
// Click handling
// ---------------------------------------------------------------------------

/**
 * Pointer feedback for modifier-click. Because a Cmd/Ctrl+click always opens a
 * link (in either open-with mode), the pointer cursor is truthful whenever the
 * modifier is held over link text. This fills the gap where "open with
 * Cmd/Ctrl+Click" gave no cursor change at all. Listens on the window (not just
 * the editor DOM) so the feedback shows while merely reading, not only while
 * the editor is focused. Both metaKey and ctrlKey count, so it is correct on
 * every platform.
 */
class ModKeyCursor {
  #held = false;
  #view: EditorView;
  constructor(view: EditorView) {
    this.#view = view;
    window.addEventListener("keydown", this.#onKey, true);
    window.addEventListener("keyup", this.#onKey, true);
    window.addEventListener("blur", this.#reset, true);
  }
  #onKey = (e: KeyboardEvent): void => this.#set(e.metaKey || e.ctrlKey);
  #reset = (): void => this.#set(false);
  #set(held: boolean): void {
    if (held === this.#held) return;
    this.#held = held;
    this.#view.dom.classList.toggle("cm-mod-held", held);
  }
  destroy(): void {
    window.removeEventListener("keydown", this.#onKey, true);
    window.removeEventListener("keyup", this.#onKey, true);
    window.removeEventListener("blur", this.#reset, true);
    this.#view.dom.classList.remove("cm-mod-held");
  }
}

export function modKeyCursor(): Extension {
  return ViewPlugin.fromClass(ModKeyCursor);
}

/**
 * The open-on-click handler. `open` receives a normalized, scheme-checked
 * URL. The click must land on rendered link text: the mark decoration spans
 * exactly that, so anchoring on it keeps the pointer cursor and clickability
 * in agreement. Coordinate mapping alone was too forgiving: clicks past the
 * end of a line, or over syntax hidden by preview replace-decorations,
 * resolve to a position inside the Link node and opened links the pointer
 * never touched.
 */
export function linkOpenHandler(open: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 || e.shiftKey || e.altKey) return false;
      const target =
        e.target instanceof Element ? e.target.closest(".cm-link-target") : null;
      if (!target) return false;
      const preview = view.state.field(previewModeField, false) ?? false;
      const prefs = view.state.field(linkPrefsField);
      const mod = e.metaKey || e.ctrlKey;
      // Plain click only opens in preview mode with the "click" preference;
      // edit mode always needs Cmd/Ctrl so clicks can place the caret.
      if (!mod && !(preview && prefs.openWith === "click")) return false;
      const pos = view.posAtDOM(target, 0);
      const url = linkAt(view.state, pos);
      if (!url) return false;
      // Swallow the event: without this a Cmd+click also spawns a second
      // CM6 cursor, and a preview click would move the caret into markup.
      e.preventDefault();
      open(url);
      return true;
    },
  });
}
