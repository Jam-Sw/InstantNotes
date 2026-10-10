import type { MarkdownConfig } from "@lezer/markdown";
import { Tag } from "@lezer/highlight";

export const highlightTag = Tag.define();

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

const EQ = 61;

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
      before: "Emphasis",
    },
  ],
};
