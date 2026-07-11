// Custom lezer-markdown syntax beyond GFM. Currently one addition:
// ==highlight== (the marker pencil), which GFM does not define but every
// serious markdown note app supports. Parsed as a proper inline node so the
// WYSIWYG layer can hide the markers and the highlight style can tint the
// span - no regex over text.

import type { MarkdownConfig } from "@lezer/markdown";
import { Tag } from "@lezer/highlight";

/** Highlight content tag, styled in markdown-highlight.ts. */
export const highlightTag = Tag.define();

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

const EQ = 61; // "="

export const highlightExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark" },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQ || cx.char(pos + 1) !== EQ) return -1;
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, true);
      },
      // Run alongside emphasis-style delimiters, before link resolution
      // swallows the characters.
      before: "Emphasis",
    },
  ],
};
