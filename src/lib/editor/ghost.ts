import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { NO_CONTEXT, type PluginConfig } from "$lib/plugin/types";
import { pluginConfig } from "./plugins";

interface Ghost {
  readonly pos: number;
  readonly text: string;
}

const DELAY = 250;
const BEFORE = 2000;
const AFTER = 500;
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "URL", "Autolink"]);

const setGhost = StateEffect.define<Ghost | null>();

function accept(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false);
  if (!ghost) return false;
  view.dispatch({
    changes: { from: ghost.pos, insert: ghost.text },
    selection: { anchor: ghost.pos + ghost.text.length },
    effects: setGhost.of(null),
    userEvent: "input.complete",
  });
  return true;
}

function dismiss(view: EditorView): boolean {
  if (!view.state.field(ghostField, false)) return false;
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(o: GhostWidget): boolean {
    return o.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-ghost";
    el.textContent = this.text;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      accept(view);
    });
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!value) return null;
    if (!tr.docChanged) return tr.selection ? null : value;
    const typed: { pos: number; text: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      typed.push({
        pos: fromA === toA && fromA === value.pos ? toB : -1,
        text: inserted.toString(),
      });
    });
    const only = typed.length === 1 ? typed[0] : null;
    if (
      !only ||
      only.pos < 0 ||
      only.text.length === 0 ||
      only.text.length >= value.text.length ||
      !value.text.startsWith(only.text) ||
      tr.newSelection.main.head !== only.pos
    ) {
      return null;
    }
    return { pos: only.pos, text: value.text.slice(only.text.length) };
  },
  provide: (f) =>
    EditorView.decorations.from(f, (ghost) =>
      ghost
        ? Decoration.set([
            Decoration.widget({
              widget: new GhostWidget(ghost.text),
              side: 1,
            }).range(ghost.pos),
          ])
        : Decoration.none,
    ),
});

function inCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (CODE.has(node.name)) return true;
  }
  return false;
}

const requester = ViewPlugin.fromClass(
  class {
    #timer: ReturnType<typeof setTimeout> | undefined;
    #abort: AbortController | null = null;

    constructor(readonly view: EditorView) {}

    update(u: ViewUpdate): void {
      if (!u.docChanged) {
        if (u.selectionSet) this.#cancel();
        return;
      }
      if (u.state.field(ghostField, false)) return;
      this.#cancel();
      if (!u.transactions.some((tr) => tr.isUserEvent("input.type"))) return;
      this.#timer = setTimeout(() => this.#ask(), DELAY);
    }

    #ask(): void {
      const view = this.view;
      const state = view.state;
      const config = state.facet(pluginConfig);
      const provider = config.plugins.find((p) => p.complete);
      if (!provider?.complete) return;
      const complete = provider.complete.bind(provider);
      const prefs = config.prefs[provider.id] ?? {};
      const context = config.context ?? NO_CONTEXT;
      const sel = state.selection.main;
      if (!sel.empty || view.composing) return;
      const head = sel.head;
      const next = state.doc.sliceString(head, Math.min(state.doc.lineAt(head).to, head + 1));
      if ((next && !/\s/.test(next)) || inCode(state, head)) return;
      const doc = state.doc;
      const abort = new AbortController();
      this.#abort = abort;
      const request = {
        before: doc.sliceString(Math.max(0, head - BEFORE), head),
        after: doc.sliceString(head, Math.min(doc.length, head + AFTER)),
      };
      Promise.resolve()
        .then(() => complete(request, prefs, context, abort.signal))
        .then((text) => {
          if (abort.signal.aborted || !text) return;
          if (view.state.doc !== doc || view.state.selection.main.head !== head) return;
          view.dispatch({ effects: setGhost.of({ pos: head, text }) });
        })
        .catch((e: unknown) => console.error(`plugin ${provider.id}`, e));
    }

    #cancel(): void {
      clearTimeout(this.#timer);
      this.#abort?.abort();
      this.#abort = null;
    }

    destroy(): void {
      this.#cancel();
    }
  },
);

const ghostKeys = Prec.highest(
  keymap.of([
    { key: "Tab", run: accept },
    { key: "Escape", run: dismiss },
  ]),
);

export function ghostExtension(config: PluginConfig): Extension {
  return config.plugins.some((p) => p.complete) ? [ghostField, ghostKeys, requester] : [];
}
