# Design: The writing surface

The owner's reference (13 Oct, a screenshot of another editor): a centered
file name in a slim top bar; one row of sixteen small icon buttons, the
active one (bold) drawn as a filled blue square with a white glyph; below it
the note's title in a large bold face, then body text, then a placeholder
"Start writing or type '/' to add". Dark theme. His words: not 1:1, learn
from it; their spacing is not perfect, and our typography is better.

What to take: one coherent icon row with a strong active state; the toolbar
as part of the surface rather than an optional mode; less air between the
title, the labels and the body. What to keep: our fonts and sizes, the title
as an editable field, the tag and Space chips under it, the status bar.

## 1. The toolbar

`FormatToolbar.svelte`, one row, groups separated by a hairline:

1. Undo, Redo (CodeMirror history; disabled when nothing to undo or redo).
2. Heading (cycles H1, H2, H3, none on the current line), Bold, Italic,
   Strikethrough, Code.
3. Quote, Bulleted list, Task list, Link, Image (desktop; the web inserts
   through paste and drop as before).
4. Markdown source (toggles `editor.sourceMode`; pressed while on).
5. Zoom out, zoom level, zoom in, at the right edge.

Every button is a 28px square, stroke icons from `Icon.svelte` (the toolbar's
inline SVGs move there, so the set is one set), `aria-pressed` for a state.
The active state is filled: `background: var(--accent)`, glyph in `var(--bg)`,
no border; hover is `var(--bg-hover)`. The letters B, I, S of 0.10.0 become
icons like the rest.

New format kinds in `markdown-format.ts`: `heading` (cycle) and `image`
(handled by the editor's existing insert path). `Editor.svelte` exposes
`undo()`, `redo()`, `canUndo()`, `canRedo()` from `@codemirror/commands`.

## 2. The toolbar and the source view, decoupled (D5)

0.10.0 tied the toolbar's visibility to the editor's mode: toolbar open meant
Markdown source shown. Now:

- `editor.toolbarOpen` is only the toolbar's visibility; default true. A
  stored false is respected (someone who hid it keeps it hidden). The
  header's "Formatting tools" button toggles it, as before.
- `editor.sourceMode` is the editor's mode; default false (marks hidden, the
  rendered view). The toolbar's Markdown button toggles it; the palette gets
  `view.markdownSource`.

## 3. Spacing

The document column: title field, then the chips row, then the body, at the
same measure. Between them: 6px title to chips (was 6), chips row padding
8px (was 10) with the hairline kept, 12px chips to the first body line. The
toolbar sits in the header's flow at 36px high, under the pane header, with
the hairline below it. The pane header keeps the note title at the left and
the icon groups at the right; the reference's centered title is a file name,
and ours is editable in the document, so the header stays as it is.

## 4. The placeholder

"Start writing… use #tags to organize" stays. A slash menu is not in this
change; the placeholder does not promise one.

## 5. Visual pass

The visual pass takes the reference description, this file and the current
screenshots, and shows before and after at desktop width in the dark
default theme and in one light theme.

## 6. Tests

`FormatToolbar.test.ts` (new): every button has a label; pressed state
follows `active`; undo and redo disable; the Markdown button reflects
`sourceMode`. `markdown-format.test.ts`: the heading cycle on a plain line,
an H1, an H3, and a line inside a list. `editor.svelte.test.ts`: the two
settings keys, the stored-false rule.
