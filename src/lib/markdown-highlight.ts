import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { highlightTag } from "./markdown-extensions";

/** @internal */
export const markdownHighlightSpec = [
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "650" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--font-meta)" },
  { tag: t.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--accent)" },
  { tag: highlightTag, backgroundColor: "var(--accent-soft)", borderRadius: "2px" },
];

export const markdownHighlight = HighlightStyle.define(markdownHighlightSpec);
