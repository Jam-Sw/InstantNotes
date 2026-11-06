import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightExtension } from "../markdown-extensions";
import { calcField, scanCalc } from "./calc";

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
