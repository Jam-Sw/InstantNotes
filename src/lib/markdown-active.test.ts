import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { activeMarks, NO_MARKS, type ActiveMarks } from "./markdown-active";

// Build a state with the same language the editor uses (GFM base, so
// strikethrough parses) and a selection, then read the active marks.
function marksAt(doc: string, from: number, to = from): ActiveMarks {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [markdown({ base: markdownLanguage })],
  });
  return activeMarks(state);
}

describe("activeMarks", () => {
  it("reports nothing in plain text", () => {
    expect(marksAt("hello world", 3)).toEqual(NO_MARKS);
  });

  it("lights bold when the caret is inside **bold**", () => {
    expect(marksAt("a **bold** b", 6)).toEqual({ ...NO_MARKS, bold: true });
  });

  it("lights italic when the caret is inside *italic*", () => {
    expect(marksAt("a *it* b", 4)).toEqual({ ...NO_MARKS, italic: true });
  });

  it("lights code when the caret is inside `code`", () => {
    expect(marksAt("run `npm` now", 6)).toEqual({ ...NO_MARKS, code: true });
  });

  it("lights strikethrough - proving GFM parsing is on", () => {
    expect(marksAt("~~gone~~ here", 4)).toEqual({ ...NO_MARKS, strike: true });
  });

  it("lights both bold and italic inside ***text***", () => {
    expect(marksAt("***ship***", 5)).toEqual({
      ...NO_MARKS,
      bold: true,
      italic: true,
    });
  });

  it("lights quote on a blockquote line", () => {
    expect(marksAt("> quoted", 4)).toEqual({ ...NO_MARKS, quote: true });
  });

  it("lights list inside a bullet item", () => {
    expect(marksAt("- item", 3)).toEqual({ ...NO_MARKS, list: true });
  });

  it("lights italic across a selection that covers it", () => {
    // "a *cap* b" - select the inner word "cap" (indices 3..6).
    expect(marksAt("a *cap* b", 3, 6)).toEqual({ ...NO_MARKS, italic: true });
  });
});
