// Inline markdown styling for the editor: markers stay visible, the text just
// looks structured. Headings are intentionally NOT styled - `#` is reserved for
// tags in InstantNotes, so `#title` stays a tag and is never rendered as a
// heading. The editor's tag highlighter styles `#tag` on top of this.

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Markdown highlight tags we must never style, so a tag can't be mistaken for a
// heading. Pinned by a test against the spec below.
export const HEADING_TAGS = [
  t.heading,
  t.heading1,
  t.heading2,
  t.heading3,
  t.heading4,
  t.heading5,
  t.heading6,
];

export const markdownHighlightSpec = [
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--font-meta)" },
  { tag: t.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent)" },
];

export const markdownHighlight = HighlightStyle.define(markdownHighlightSpec);
