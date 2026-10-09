import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { previewModeField } from "./kernel";

export type LinkOpenWith = "click" | "modclick";
export type LinkUnderline = "always" | "hover" | "never";

export interface LinkPrefsSnapshot {
  openWith: LinkOpenWith;
  underline: LinkUnderline;
  tooltip: boolean;
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

/** @internal */
export function normalizeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return null;
}

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

export function linkMarkClass(prefs: LinkPrefsSnapshot, preview: boolean): string {
  let cls = `cm-link-target cm-link-ul-${prefs.underline}`;
  if (preview && prefs.openWith === "click") cls += " cm-link-clickable";
  if (prefs.externalIndicator) cls += " cm-link-ext";
  return cls;
}

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
      if (!mod && !(preview && prefs.openWith === "click")) return false;
      const pos = view.posAtDOM(target, 0);
      const url = linkAt(view.state, pos);
      if (!url) return false;
      e.preventDefault();
      open(url);
      return true;
    },
  });
}

export function droppedLink(data: Pick<DataTransfer, "getData">): string | null {
  const [mozUrl, mozTitle] = data.getData("text/x-moz-url").split("\n");
  if (!mozUrl && !data.getData("text/uri-list")) return null;
  const anchor = new DOMParser()
    .parseFromString(data.getData("text/html"), "text/html")
    .querySelector("a[href]");
  const url = normalizeHref(
    mozUrl || anchor?.getAttribute("href") || data.getData("text/uri-list").split("\n")[0] || "",
  );
  const title = (mozTitle || anchor?.textContent || "").replace(/\s+/g, " ").trim();
  if (!url || !title || title === url) return null;
  return `[${title.replace(/[[\]]/g, "\\$&")}](${url.replace(/[()\s]/g, encodeURIComponent)})`;
}

export function linkDrop(): Extension {
  return EditorView.domEventHandlers({
    drop(e, view) {
      if (!e.dataTransfer || e.dataTransfer.files.length > 0) return false;
      const insert = droppedLink(e.dataTransfer);
      if (!insert) return false;
      e.preventDefault();
      const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.from;
      view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
      view.focus();
      return true;
    },
  });
}
