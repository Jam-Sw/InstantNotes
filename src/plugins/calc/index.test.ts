import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightExtension } from "$lib/markdown-extensions";
import { pluginConfig, pluginField, scanPlugins } from "$lib/editor/plugins";
import type { Figure } from "$lib/calc/plot";
import calc from "./index";

const cfg = (precision?: string) =>
  pluginConfig.of({ plugins: [calc], prefs: precision ? { calc: { precision } } : {} });

function scan(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [highlightExtension] }), cfg()],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return scanPlugins(state).items;
}

const texts = (items: ReturnType<typeof scan>) => items.map((i) => i.views.map((p) => p.text).join("|"));

describe("calc in a note", () => {
  it("evaluates a calc fence line by line and shares variables with inline code and tables", () => {
    const doc = [
      "```calc",
      "price = 2.5",
      "qty = 4;",
      "price * qty",
      "```",
      "",
      "Total is `=price*qty` with tax `=ans*1.2`.",
      "",
      "| Item | Cost |",
      "| --- | --- |",
      "| Pen | =price |",
      "| All | =sum(above)*qty |",
    ].join("\n");
    const items = scan(doc);
    expect(items.map((i) => i.kind)).toEqual(["line", "line", "inline", "inline", "cell", "cell"]);
    expect(texts(items)).toEqual(["2.5", "10", "10", "12", "2.5", "10"]);
    expect(doc.slice(items[2].from, items[2].to)).toBe("`=price*qty`");
    expect(doc.slice(items[2].innerFrom, items[2].innerTo)).toBe("=price*qty");
    expect(doc.slice(items[4].innerFrom, items[4].innerTo)).toBe("=price");
  });

  it("ignores other fences, plain inline code and arrows", () => {
    expect(scan("```js\n1 + 1\n```\n\n`code` and `=>` and `==`")).toEqual([]);
  });

  it("honours comments, format and errors", () => {
    const items = scan("```calc\nformat long\n1/3\n% note\nx = y + 1\n```");
    expect(texts(items)).toEqual(["0.333333333333333", "undefined: y"]);
    expect(items[1].views[0].error).toBe(true);
  });

  it("renders a matrix as a grid part", () => {
    const [item] = scan("```calc\n[1 2; 3 4]\n```");
    expect(item.views[0].grid).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("finds items by range", async () => {
    const doc = "`=1+1` and `=2+2`";
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), cfg()] });
    ensureSyntaxTree(state, doc.length, 5000);
    const table = scanPlugins(state);
    expect(table.between(0, 6).map((i) => i.views[0].text)).toEqual(["2"]);
    expect(table.between(8, doc.length).map((i) => i.views[0].text)).toEqual(["4"]);
    expect(table.between(0, doc.length).length).toBe(2);
  });
});

describe("calc in a live editor", () => {
  it("renders result pills in both modes and swaps the inline formula for its value in preview", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel, setPreviewMode } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { InlineMarkSpec } = await import("$lib/editor/constructs/inline-marks");
    const { extension } = previewKernel({
      specs: [new InlineMarkSpec()],
      textSpecs: [new PluginSpec()],
      rescanOn: [pluginField],
    });
    const doc = "```calc\nx = 6 * 7\n```\n\nso `=x/2` here";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [pluginField, cfg(), extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      const pills = () => Array.from(view.contentDOM.querySelectorAll(".cm-plugin")).map((e) => e.textContent);
      expect(pills()).toEqual(["42", "21"]);
      expect(view.contentDOM.textContent).toContain("=x/2");
      view.dispatch({ effects: setPreviewMode.of(true) });
      expect(pills()).toEqual(["42", "21"]);
      expect(view.contentDOM.textContent).not.toContain("=x/2");
      view.dispatch({ changes: { from: doc.indexOf("7"), to: doc.indexOf("7") + 1, insert: "8" } });
      expect(pills()).toEqual(["48", "24"]);
    } finally {
      view.destroy();
    }
  });
});

describe("plots in a note", () => {
  it("adds one figure item at the end of each fence that drew, and prints nothing for draw lines", () => {
    const doc = [
      "```calc",
      "x = linspace(0, 1, 5);",
      "plot(x, x.^2)",
      "figure",
      "plot3(x, x, x)",
      "1 + 1",
      "```",
      "",
      "```calc",
      "2 + 2",
      "```",
    ].join("\n");
    const items = scan(doc);
    expect(items.map((i) => i.kind)).toEqual(["line", "block", "line"]);
    expect(texts(items)).toEqual(["2", "", "4"]);
    const fig = items[1];
    expect(fig.from).toBe(doc.indexOf("```\n\n") + 3);
    expect(fig.blocks.map((b) => [b.id, (b.data as Figure).dims])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("reuses results when no calc source changed and shifts their positions", () => {
    const doc = "intro\n\n```calc\nx = 2\nplot(1:3)\n```\n\nsee `=x+1`";
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), pluginField, cfg()] });
    ensureSyntaxTree(state, doc.length, 5000);
    const before = state.field(pluginField);
    state = state.update({ changes: { from: 0, insert: "more " } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    const after = state.field(pluginField);
    expect(after.items.map((i) => i.from)).toEqual(before.items.map((i) => i.from + 5));
    expect(after.items.map((i) => i.blocks)).toEqual(before.items.map((i) => i.blocks));
    after.items.forEach((it, i) => expect(it.blocks).toBe(before.items[i].blocks));
    expect(state.doc.sliceString(after.items[2].innerFrom, after.items[2].innerTo)).toBe("=x+1");
    const at = state.doc.toString().indexOf("x = 2") + 4;
    state = state.update({ changes: { from: at, to: at + 1, insert: "5" } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    expect(texts(state.field(pluginField).items)).toEqual(["5", "", "6"]);
  });

  it("keeps figures per fence and refuses inline plots", () => {
    const items = scan("```calc\nplot(1:3)\n```\n\n```calc\nhold on\n```\n\nand `=plot(1)`");
    expect(items.map((i) => i.kind)).toEqual(["block", "block", "inline"]);
    expect((items[1].blocks[0].data as Figure).series).toEqual([]);
    expect(items[2].views[0]).toMatchObject({ error: true, text: "plot needs a calc block" });
  });

  it("renders figures under the fence and keeps them across unrelated edits", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { extension } = previewKernel({ specs: [], textSpecs: [new PluginSpec()], rescanOn: [pluginField] });
    const doc = "intro\n\n```calc\nplot([1 2 3])\nfigure\nplot3(1:3, 1:3, 1:3)\n```";
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [pluginField, cfg(), extension, markdown({ base: markdownLanguage })] }),
      parent: document.body,
    });
    try {
      const figs = () => Array.from(view.contentDOM.querySelectorAll(".cm-figure"));
      expect(figs().map((f) => f.querySelector("svg")?.getAttribute("aria-label"))).toEqual([
        "Figure 1, 2D, 1 line",
        "Figure 2, 3D, 1 line",
      ]);
      const first = figs()[0];
      const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
      first.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
      expect(first.querySelectorAll(".cm-figure-lines polyline")).toHaveLength(1);
      view.dispatch({ changes: { from: 0, insert: "more " } });
      expect(figs()[0]).toBe(first);
      const at = view.state.doc.toString().indexOf("[1 2 3]");
      view.dispatch({ changes: { from: at, to: at + 7, insert: "[1 5 3 4]" } });
      expect(figs()).toHaveLength(2);
      expect(figs()[0]).toBe(first);
      await new Promise((r) => requestAnimationFrame(r));
      expect(figs()[0].querySelector(".cm-figure-lines polyline")?.getAttribute("points")?.split(" ")).toHaveLength(4);
    } finally {
      view.destroy();
    }
  });
});

describe("calc precision setting", () => {
  const doc = "```calc\n1/3\n```";
  const run = (precision?: string) => {
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [highlightExtension] }), cfg(precision)],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return scanPlugins(state).items[0].views[0].text;
  };

  it("uses short formatting by default and long when set", () => {
    const short = run();
    expect(run("short")).toBe(short);
    expect(run("long").length).toBeGreaterThan(short.length);
  });
});

describe("calc fences, multi-line control flow, and plot isolation", () => {
  it("evaluates calc and m fenced blocks and shares scope across fences", () => {
    const doc = ["```calc", "A = [3 1; 1 2]; b = [9; 8];", "x = A \\ b", "```", "", "```m", "sum(x)", "```"].join("\n");
    const items = scan(doc);
    expect(texts(items)).toEqual(["[2; 3]", "5"]);
  });

  it("isolates pointer and mouse events on .cm-plugin-blocks so dragging a plot never moves the editor caret", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel, setPreviewMode } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { FenceSpec } = await import("$lib/editor/constructs/fence");
    const { extension } = previewKernel({
      specs: [new FenceSpec()],
      textSpecs: [new PluginSpec()],
      rescanOn: [pluginField],
    });
    const doc = "heading\n\n```calc\nplot([1 2 3], [4 5 6])\n```\n\ntrailing text";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [pluginField, cfg(), extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      view.dispatch({ effects: setPreviewMode.of(true) });
      const wrap = view.contentDOM.querySelector(".cm-plugin-blocks") as HTMLElement;
      const fig = view.contentDOM.querySelector(".cm-figure") as HTMLElement;
      expect(wrap.contentEditable).toBe("false");
      fig.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      fig.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      fig.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      expect(view.state.selection.main.head).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it("evaluates multi-line control flow, functions, and plots natively", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { extension } = previewKernel({ specs: [], textSpecs: [new PluginSpec()], rescanOn: [pluginField] });
    const doc = [
      "```calc",
      "function y = sq(x)",
      "  y = x.^2;",
      "end",
      "s = 0;",
      "for k = 1:5",
      "  if k > 0",
      "    s = s + k;",
      "  end",
      "end",
      "s",
      "plot(1:3, sq(1:3))",
      "```",
      "",
      "Total `=s`",
    ].join("\n");

    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [pluginField, cfg(), extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      const pills = Array.from(view.contentDOM.querySelectorAll(".cm-plugin")).map((e) => e.textContent);
      expect(pills).toEqual(["15", "15"]);
      expect(view.contentDOM.querySelectorAll(".cm-figure")).toHaveLength(1);
    } finally {
      view.destroy();
    }
  });
});
