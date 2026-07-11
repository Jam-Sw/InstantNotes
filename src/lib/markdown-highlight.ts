// Inline markdown styling for the editor: markers stay visible, the text just
// looks structured.
//
// Headings and tags coexist without ambiguity: CommonMark only parses
// `# Heading` (with a space) as a heading, and the editor's tag highlighter
// only matches `#tag` (no space). So `#roadmap` stays a tag and `# Roadmap`
// renders as a title - two different gestures, two different meanings.

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { highlightTag } from "./markdown-extensions";

export const markdownHighlightSpec = [
  // heading1..3 get distinct scale; deeper levels share the generic heading
  // weight (lezer tag hierarchy: headingN falls back to heading).
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "650" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--font-meta)" },
  { tag: t.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  // Underline is owned by the link-appearance setting (src/lib/editor), not
  // baked in here, so "underline: never/hover" can actually win.
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--accent)" },
  // ==highlight== spans, parsed by the custom extension in
  // markdown-extensions.ts.
  { tag: highlightTag, backgroundColor: "var(--accent-soft)", borderRadius: "2px" },
];

export const markdownHighlight = HighlightStyle.define(markdownHighlightSpec);
