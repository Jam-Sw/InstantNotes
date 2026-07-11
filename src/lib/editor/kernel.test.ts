// The kernel's experience contract, enforced as properties over a corpus of
// every construct (see ARCHITECTURE.md). These are not per-feature tests:
// they assert the invariants that make "typing into invisible markup"
// structurally impossible, for every construct at every caret position.

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightExtension } from "../markdown-extensions";
import { ConstructScanner, type ConstructTable } from "./scanner";
import { linkPrefsField } from "./links";
import { attachmentsBaseField, setAttachmentsBase } from "./images";
import { InlineMarkSpec } from "./constructs/inline-marks";
import { LinkSpec } from "./constructs/link";
import { HeadingSpec } from "./constructs/heading";
import { FenceSpec } from "./constructs/fence";
import { TableSpec } from "./constructs/table";
import { ListSpec } from "./constructs/list";
import { QuoteSpec } from "./constructs/quote";
import { HrSpec } from "./constructs/hr";
import { TaskSpec } from "./constructs/task";
import { ImageSpec } from "./constructs/image";
import { TagSpec } from "./constructs/tags";

// Mirrors the registry in index.ts, with a fake asset converter so no Tauri
// runtime is needed.
function makeScanner(): ConstructScanner {
  return new ConstructScanner(
    [
      new InlineMarkSpec(),
      new LinkSpec(),
      new HeadingSpec(),
      new FenceSpec(),
      new TableSpec(),
      new ListSpec(),
      new QuoteSpec(),
      new HrSpec(),
      new TaskSpec(),
      new ImageSpec((p) => `asset://${p}`),
    ],
    [new TagSpec()],
  );
}

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [highlightExtension] }),
      linkPrefsField,
      attachmentsBaseField,
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function tableOf(state: EditorState, preview = true): ConstructTable {
  return makeScanner().scan(
    state,
    [{ from: 0, to: state.doc.length }],
    preview,
  );
}

// One line (or block) per construct the kernel supports, blank-line
// separated so blocks terminate the way they do in real notes.
const CORPUS = [
  "plain text with #tag inline",
  "",
  "# Heading one",
  "",
  "## Second heading",
  "",
  "**bold** and *italic* and ~~gone~~ and `code`",
  "",
  "==marked== text",
  "",
  "a [link](https://example.com) mid line",
  "",
  "trailing [LINK_CLICK_ME](https://example.com/x)",
  "",
  "<https://example.com> autolink",
  "",
  "bare https://example.com url",
  "",
  "- bullet item",
  "",
  "12. ordered item",
  "",
  "- [ ] open task",
  "",
  "- [x] done task",
  "",
  "> quoted line",
  "",
  "---",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "![alt](attachments/pic.png)",
].join("\n");

describe("kernel invariants", () => {
  it("WRITING: no invisible fold ever touches the caret, at any position", () => {
    const state = stateOf(CORPUS);
    const table = tableOf(state);
    for (let pos = 0; pos <= CORPUS.length; pos++) {
      const folded = table.foldedHides([{ from: pos, to: pos }]);
      for (const h of folded) {
        if (h.widget) continue; // widgets are visible objects, guarded by atomic ranges
        expect(
          h.to < pos || h.from > pos,
          `invisible hidden range [${h.from},${h.to}] "${CORPUS.slice(h.from, h.to)}" touches caret at ${pos}`,
        ).toBe(true);
      }
    }
  });

  it("SELECTING: a selection reveals every non-widget construct it overlaps", () => {
    const state = stateOf(CORPUS);
    const table = tableOf(state);
    const folded = table.foldedHides([{ from: 0, to: CORPUS.length }]);
    expect(folded.every((h) => h.widget)).toBe(true);
  });

  it("the original complaint: caret at the end of a trailing link's text reveals the whole link", () => {
    const doc = "trailing [LINK_CLICK_ME](https://example.com/x)";
    const table = tableOf(stateOf(doc));
    const pos = doc.indexOf("LINK_CLICK_ME") + "LINK_CLICK_ME".length;
    expect(doc[pos]).toBe("]");
    const invisible = table
      .foldedHides([{ from: pos, to: pos }])
      .filter((h) => !h.widget);
    expect(invisible).toEqual([]);
  });

  it("CLICKING: past the visible end of a link line, everything to the line end is folded", () => {
    const doc = "trailing [LINK_CLICK_ME](https://example.com/x)";
    const table = tableOf(stateOf(doc));
    const textEnd = doc.indexOf("LINK_CLICK_ME") + "LINK_CLICK_ME".length;
    const away = [{ from: 0, to: 0 }]; // caret elsewhere, link folded
    // From the last visible glyph to the line end is pure hidden markup, so
    // CaretGuard snaps such a click to the line end.
    expect(table.allHiddenBetween(textEnd, doc.length, away)).toBe(true);
    // One glyph earlier is visible text: no snapping.
    expect(table.allHiddenBetween(textEnd - 1, doc.length, away)).toBe(false);
  });

  it("caret legality: atomic ranges are exactly the folded hides", () => {
    const state = stateOf(CORPUS);
    const table = tableOf(state);
    const sel = [{ from: 0, to: 0 }];
    const folded = table.foldedHides(sel);
    const atomic = table.atomicRanges(sel);
    let count = 0;
    const cursor = atomic.iter();
    while (cursor.value !== null) {
      count++;
      cursor.next();
    }
    expect(count).toBe(folded.length);
  });

  it("edit mode folds nothing", () => {
    const state = stateOf(CORPUS);
    const table = tableOf(state, false);
    expect(table.foldedHides([{ from: 0, to: 0 }])).toEqual([]);
  });
});

describe("construct parity", () => {
  function hiddenTexts(doc: string, sel = [{ from: 0, to: 0 }]): string[] {
    const table = tableOf(stateOf(doc));
    return table.foldedHides(sel).map((h) => doc.slice(h.from, h.to));
  }

  it("folds link markup, keeps the text", () => {
    expect(hiddenTexts("a [docs](https://x.dev) b")).toEqual([
      "[",
      "](https://x.dev)",
    ]);
  });

  it("folds autolink angle brackets", () => {
    expect(hiddenTexts("go <https://x.dev> now")).toEqual(["<", ">"]);
  });

  it("folds inline emphasis marks, including inside link text", () => {
    // Prefixed so the caret at 0 sits before the constructs (as the link and
    // autolink cases above do); a caret touching a construct reveals it.
    expect(hiddenTexts("a **b** [*i*](https://x.dev)")).toEqual([
      "**",
      "**",
      "[",
      "*",
      "*",
      "](https://x.dev)",
    ]);
  });

  it("folds the heading prefix", () => {
    // Caret in the body, off the heading line: on the line, the prefix reveals.
    expect(hiddenTexts("# Title\n\nbody", [{ from: 9, to: 9 }])).toEqual(["# "]);
  });

  it("folds highlight marks", () => {
    expect(hiddenTexts("a ==hot== take")).toEqual(["==", "=="]);
  });

  it("folds the quote prefix per line: the caret's line opens, others stay", () => {
    const doc = "> first\n> second";
    const table = tableOf(stateOf(doc));
    // Caret on the first quote line: its > opens, the second stays folded.
    const folded = table.foldedHides([{ from: 2, to: 2 }]);
    expect(folded.map((h) => h.from)).toEqual([doc.indexOf("> second")]);
  });

  it("replaces list markers with widgets", () => {
    const doc = "- bullet\n\n12. numbered";
    const table = tableOf(stateOf(doc));
    const folded = table.foldedHides([{ from: doc.length, to: doc.length }]);
    const listFolds = folded.filter((h) => h.widget);
    expect(listFolds.map((h) => doc.slice(h.from, h.to))).toEqual(["- ", "12. "]);
  });

  it("keeps a checked task struck in both modes and its marker a widget in preview", () => {
    const doc = "- [x] shipped";
    const state = stateOf(doc);
    for (const preview of [true, false]) {
      const table = tableOf(state, preview);
      let struck = false;
      table
        .decorations([{ from: 0, to: 0 }])
        .between(0, doc.length, (_f, _t, deco) => {
          if (deco.spec.class === "cm-task-done") struck = true;
        });
      expect(struck, `cm-task-done missing (preview=${preview})`).toBe(true);
    }
    const folded = tableOf(state).foldedHides([{ from: doc.length, to: doc.length }]);
    expect(folded.some((h) => h.widget && doc.slice(h.from, h.to) === "[x] ")).toBe(true);
  });

  it("renders attachment images as widgets once the base directory lands", () => {
    // Lead-in text keeps the caret-at-0 selection off the image so it folds.
    const doc = "pic:\n\n![alt](attachments/pic.png)";
    const caret = [{ from: 0, to: 0 }];
    const isImage = (h: { widget: boolean; from: number; to: number }) =>
      h.widget && doc.slice(h.from, h.to).startsWith("![");

    // Before the async base directory arrives: markdown text, no widget.
    expect(tableOf(stateOf(doc)).foldedHides(caret).some(isImage)).toBe(false);

    const withBase = stateOf(doc).update({
      effects: setAttachmentsBase.of("/data/App"),
    }).state;
    ensureSyntaxTree(withBase, doc.length, 5000);
    expect(tableOf(withBase).foldedHides(caret).some(isImage)).toBe(true);
  });

  it("marks tags in both modes", () => {
    const doc = "note about #spaces here";
    for (const preview of [true, false]) {
      const table = tableOf(stateOf(doc), preview);
      let tagged: string | null = null;
      table.decorations([{ from: 0, to: 0 }]).between(0, doc.length, (f, t, deco) => {
        if (deco.spec.class === "cm-tag") tagged = doc.slice(f, t);
      });
      expect(tagged).toBe("#spaces");
    }
  });

  it("gives fence lines chrome and folds the fence marks", () => {
    const doc = "```js\nconst x = 1;\n```";
    const state = stateOf(doc);
    const table = tableOf(state);
    const folded = table.foldedHides([{ from: 0, to: 0 }]);
    // Caret inside the fence reveals the backticks (whole-fence construct).
    expect(folded).toEqual([]);
    const away = tableOf(
      stateOf(`intro\n\n${doc}`),
    ).foldedHides([{ from: 0, to: 0 }]);
    expect(away.map((h) => `intro\n\n${doc}`.slice(h.from, h.to))).toEqual([
      "```",
      "```",
    ]);
  });
});
