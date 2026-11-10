import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ghostExtension } from "./ghost";
import { pluginConfig } from "./plugins";
import type { Plugin, PluginConfig } from "$lib/plugin/types";

function provider(complete: Plugin["complete"]): PluginConfig {
  const plugin: Plugin = { id: "t", label: "T", api: 1, run: () => [], complete };
  return { plugins: [plugin], prefs: {} };
}

const slot = new Compartment();
const wired = (config: PluginConfig) => [pluginConfig.of(config), ghostExtension(config)];

function mount(doc: string, config: PluginConfig): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [slot.of(wired(config)), markdown({ base: markdownLanguage })],
    }),
    parent: document.body,
  });
}

function type(view: EditorView, text: string): void {
  const at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
}

const press = (view: EditorView, key: string, keyCode: number) =>
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true }));

const shown = (view: EditorView) => view.contentDOM.querySelector(".cm-ghost")?.textContent ?? null;

async function pause(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ghost text", () => {
  it("adds nothing when no plugin completes", () => {
    expect(ghostExtension({ plugins: [], prefs: {} })).toEqual([]);
  });

  it("shows a suggestion after a typing pause and Tab writes it", async () => {
    const view = mount("We wal", provider(({ before }) => (before.endsWith("walk") ? "ed home" : null)));
    try {
      type(view, "k");
      expect(shown(view)).toBeNull();
      await pause();
      expect(shown(view)).toBe("ed home");
      expect(view.state.doc.toString()).toBe("We walk");
      press(view, "Tab", 9);
      expect(view.state.doc.toString()).toBe("We walked home");
      expect(view.state.selection.main.head).toBe(14);
      expect(shown(view)).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("keeps the rest while the user types along, and drops it on anything else", async () => {
    const view = mount("pla", provider(() => "nning"));
    try {
      type(view, "n");
      await pause();
      expect(shown(view)).toBe("nning");
      type(view, "n");
      expect(shown(view)).toBe("ning");
      type(view, "x");
      expect(shown(view)).toBeNull();
      await pause();
      expect(shown(view)).toBe("nning");
      press(view, "Escape", 27);
      expect(shown(view)).toBeNull();
      expect(view.state.doc.toString()).toBe("plannx");
    } finally {
      view.destroy();
    }
  });

  it("still answers when the plugin config is rebuilt during the pause", async () => {
    const view = mount("We walk", provider(() => "ed"));
    try {
      type(view, "k");
      view.dispatch({ effects: slot.reconfigure(wired(provider(() => "ing"))) });
      await pause();
      expect(shown(view)).toBe("ing");
    } finally {
      view.destroy();
    }
  });

  it("ignores an answer that arrives after the text moved on", async () => {
    let release: (text: string) => void = () => {};
    const view = mount("slow", provider(() => new Promise<string>((r) => (release = r))));
    try {
      type(view, "e");
      await pause();
      type(view, "r");
      release(" answer");
      await vi.advanceTimersByTimeAsync(0);
      expect(shown(view)).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("stays quiet in the middle of a word, in code, and for edits that are not typing", async () => {
    const calls: string[] = [];
    const config = provider(({ before }) => {
      calls.push(before);
      return "x";
    });
    const mid = mount("hello", config);
    const code = mount("```js\nlet a", config);
    const paste = mount("note", config);
    try {
      mid.dispatch({ selection: { anchor: 2 } });
      type(mid, "y");
      type(code, "b");
      paste.dispatch({ changes: { from: 4, insert: " pasted" }, userEvent: "input.paste" });
      await pause();
      expect(calls).toEqual([]);
    } finally {
      mid.destroy();
      code.destroy();
      paste.destroy();
    }
  });
});
