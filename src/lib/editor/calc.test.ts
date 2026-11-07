import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightExtension } from "../markdown-extensions";
import { calcField, calcPrecision, scanCalc } from "./calc";

function scan(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [highlightExtension] })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return scanCalc(state).items;
}

const texts = (items: ReturnType<typeof scan>) => items.map((i) => i.parts.map((p) => p.text).join("|"));

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
    expect(items[1].parts[0].error).toBe(true);
  });

  it("renders a matrix as a grid part", () => {
    const [item] = scan("```calc\n[1 2; 3 4]\n```");
    expect(item.parts[0].grid).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("finds items by range", async () => {
    const doc = "`=1+1` and `=2+2`";
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(state, doc.length, 5000);
    const table = (await import("./calc")).scanCalc(state);
    expect(table.between(0, 6).map((i) => i.parts[0].text)).toEqual(["2"]);
    expect(table.between(8, doc.length).map((i) => i.parts[0].text)).toEqual(["4"]);
    expect(table.between(0, doc.length).length).toBe(2);
  });
});

describe("calc in a live editor", () => {
  it("renders result pills in both modes and swaps the inline formula for its value in preview", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel, setPreviewMode } = await import("./kernel");
    const { CalcSpec } = await import("./constructs/calc");
    const { InlineMarkSpec } = await import("./constructs/inline-marks");
    const { extension } = previewKernel({
      specs: [new InlineMarkSpec()],
      textSpecs: [new CalcSpec()],
      rescanOn: [calcField],
    });
    const doc = "```calc\nx = 6 * 7\n```\n\nso `=x/2` here";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [calcField, extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      const pills = () => Array.from(view.contentDOM.querySelectorAll(".cm-calc")).map((e) => e.textContent);
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
    expect(items.map((i) => i.kind)).toEqual(["line", "figure", "line"]);
    expect(texts(items)).toEqual(["2", "", "4"]);
    const fig = items[1];
    expect(fig.from).toBe(doc.indexOf("```\n\n") + 3);
    expect(fig.figures.map((f) => [f.id, f.dims])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("reuses results when no calc source changed and shifts their positions", () => {
    const doc = "intro\n\n```calc\nx = 2\nplot(1:3)\n```\n\nsee `=x+1`";
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), calcField] });
    ensureSyntaxTree(state, doc.length, 5000);
    const before = state.field(calcField);
    state = state.update({ changes: { from: 0, insert: "more " } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    const after = state.field(calcField);
    expect(after.items.map((i) => i.from)).toEqual(before.items.map((i) => i.from + 5));
    expect(after.items.map((i) => i.figures)).toEqual(before.items.map((i) => i.figures));
    after.items.forEach((it, i) => expect(it.figures).toBe(before.items[i].figures));
    expect(state.doc.sliceString(after.items[2].innerFrom, after.items[2].innerTo)).toBe("=x+1");
    const at = state.doc.toString().indexOf("x = 2") + 4;
    state = state.update({ changes: { from: at, to: at + 1, insert: "5" } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    expect(texts(state.field(calcField).items)).toEqual(["5", "", "6"]);
  });

  it("keeps figures per fence and refuses inline plots", () => {
    const items = scan("```calc\nplot(1:3)\n```\n\n```calc\nhold on\n```\n\nand `=plot(1)`");
    expect(items.map((i) => i.kind)).toEqual(["figure", "figure", "inline"]);
    expect(items[1].figures[0].series).toEqual([]);
    expect(items[2].parts[0]).toMatchObject({ error: true, text: "plot needs a calc block" });
  });

  it("renders figures under the fence and keeps them across unrelated edits", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("./kernel");
    const { CalcSpec } = await import("./constructs/calc");
    const { extension } = previewKernel({ specs: [], textSpecs: [new CalcSpec()], rescanOn: [calcField] });
    const doc = "intro\n\n```calc\nplot([1 2 3])\nfigure\nplot3(1:3, 1:3, 1:3)\n```";
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [calcField, extension, markdown({ base: markdownLanguage })] }),
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
  const run = (extra: import("@codemirror/state").Extension[]) => {
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [highlightExtension] }), ...extra],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return scanCalc(state).items[0].parts[0].text;
  };

  it("uses short formatting by default and long when set", () => {
    const short = run([]);
    expect(run([calcPrecision.of("short")])).toBe(short);
    expect(run([calcPrecision.of("long")]).length).toBeGreaterThan(short.length);
  });
});

describe("matlab fences, multi-line control flow, and plot isolation", () => {
  it("evaluates matlab and m fenced blocks and shares scope across fences", () => {
    const doc = ["```matlab", "A = [3 1; 1 2]; b = [9; 8];", "x = A \\ b", "```", "", "```m", "sum(x)", "```"].join("\n");
    const items = scan(doc);
    expect(texts(items)).toEqual(["[2; 3]", "5"]);
  });

  it("isolates pointer and mouse events on .cm-figures so dragging a plot never moves the editor caret", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel, setPreviewMode } = await import("./kernel");
    const { CalcSpec } = await import("./constructs/calc");
    const { FenceSpec } = await import("./constructs/fence");
    const { extension } = previewKernel({
      specs: [new FenceSpec()],
      textSpecs: [new CalcSpec()],
      rescanOn: [calcField],
    });
    const doc = "heading\n\n```matlab\nplot([1 2 3], [4 5 6])\n```\n\ntrailing text";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [calcField, extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      view.dispatch({ effects: setPreviewMode.of(true) });
      const wrap = view.contentDOM.querySelector(".cm-figures") as HTMLElement;
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

  it("evaluates multi-line MATLAB control flow, functions, and plots natively", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("./kernel");
    const { CalcSpec } = await import("./constructs/calc");
    const { extension } = previewKernel({ specs: [], textSpecs: [new CalcSpec()], rescanOn: [calcField] });
    const doc = [
      "```matlab",
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
        extensions: [calcField, extension, markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    try {
      const pills = Array.from(view.contentDOM.querySelectorAll(".cm-calc")).map((e) => e.textContent);
      expect(pills).toEqual(["15", "15"]);
      expect(view.contentDOM.querySelectorAll(".cm-figure")).toHaveLength(1);
    } finally {
      view.destroy();
    }
  });
});
