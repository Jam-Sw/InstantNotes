import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { highlightExtension } from "./markdown-extensions";

// Same parser setup as the editor.
function treeNames(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [highlightExtension] }),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter(n) {
      names.push(n.name);
    },
  });
  return names;
}

describe("highlightExtension", () => {
  it("parses ==text== into a Highlight node with marks", () => {
    const names = treeNames("this is ==important== stuff");
    expect(names).toContain("Highlight");
    expect(names).toContain("HighlightMark");
  });

  it("leaves single = alone", () => {
    const names = treeNames("a = b and c =d");
    expect(names).not.toContain("Highlight");
  });

  it("nests emphasis inside a highlight", () => {
    const names = treeNames("==really **bold** point==");
    expect(names).toContain("Highlight");
    expect(names).toContain("StrongEmphasis");
  });
});
