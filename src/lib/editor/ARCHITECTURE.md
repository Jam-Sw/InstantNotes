# The editor kernel

`src/lib/editor/` is the platform layer between CodeMirror 6 and every
markdown feature InstantNotes has or will have. It exists because the previous
design (one self-contained extension per feature) let five separate tree walks
each invent their own answer to "what is hidden, where may the caret go, what
is clickable," and those answers drifted apart. Every editor bug shipped so
far was one of those disagreements.

The kernel replaces the seams with one pipeline:

    lezer parse  ->  ConstructScanner (ONE walk)  ->  ConstructTable
                                                        |-- decorations (render)
                                                        |-- atomic ranges (caret legality)
                                                        |-- reveal state (what shows raw)
                                                        |-- hit info (what a click means)

Features are `ConstructSpec` classes registered with the scanner. A spec
declares what a construct looks like; it never touches the view, events, or
other constructs. The kernel derives rendering, caret rules, and click routing
from the same table, so they cannot disagree by construction.

## The experience contract

These are invariants of the whole editing experience, not per-feature rules.
`kernel.test.ts` enforces the testable ones over a corpus of every construct.

1. WRITING. A keystroke always lands visibly. No zero-width hidden range may
   touch the caret: any construct the selection touches (boundary inclusive)
   shows its raw syntax while touched. Enter continues lists, quotes, and
   tasks (markdownKeymap).
2. DELETING. Markers behave like objects. Backspace at a marker boundary
   removes the marker whole (keymap + atomic ranges); deletion can never eat
   text the eye has not seen.
3. SELECTING. Anything a selection covers is fully visible while covered, so
   copy and delete operate on exactly what is on screen.
4. CLICKING. The caret lands where the eye says. A click past the visible end
   of a line goes to the true end of line, never invisibly inside markup.
   Clickability, pointer cursor, tooltip, and open target all derive from the
   construct table.
5. READING. Constructs reveal per smallest sensible unit (a quote line, not
   the whole quote), widgets are stable across rebuilds (eq()), and the whole
   system costs one tree walk per update, viewport scoped, at any note size.

## Modules

Each module is directly specified: purpose, construction, public surface.

- `types.ts`: the construct model. `ConstructSpec` (tree driven), `TextSpec`
  (text driven, e.g. tags), `Emit` (what a spec may declare: construct spans,
  hides, marks, line chrome), `RevealMode` (`span` reveals on touch, `never`
  is widget-stable).
- `scanner.ts`: `ConstructScanner` class. Constructor takes the spec
  registry; `scan(state, ranges, preview)` performs the single syntax-tree
  walk and returns a `ConstructTable`. `ConstructTable` encapsulates the scan
  result; public queries: `decorations(sel)`, `atomicRanges(sel)`,
  `constructAt(pos)`. Pure over EditorState, fully unit testable.
- `reveal.ts`: the one reveal predicate. `revealed(construct, selFrom, selTo)`
  boundary inclusive. No other module may reimplement this comparison.
- `kernel.ts`: `previewModeField` and the `PreviewKernel` ViewPlugin that owns
  the scan lifecycle (doc, viewport, selection, mode, prefs) and exposes the
  table to the view layer.
- `caret.ts`: `CaretGuard`. Atomic ranges wiring plus pointer normalization
  (contract 4). The only module allowed to touch selection placement.
- `constructs/`: one spec class per construct: inline marks, link, heading,
  fence, table, list, quote, hr, task, image, tags. Parity with the retired
  wysiwyg.ts, link-click.ts, task-list.ts, image-preview.ts behavior.
- `links.ts`, `images.ts`, `tasks.ts`, `blocks.ts`: behavior modules (open
  routing, paste/drop capture, toggle, marker backspace) plus their pure,
  tested helpers. State fields and effects keep their old names.
- `theme.ts`: all kernel base themes in one place.
- `index.ts`: `editorKernel(opts)`, the only entry point. Editor.svelte
  consumes this and nothing else from the kernel.

Outside the kernel, unchanged by design: parsing (`markdown-extensions.ts`),
paint (`markdown-highlight.ts`), commands (`markdown-format.ts`,
`list-indent.ts`), queries (`markdown-active.ts`). They are upstream or
downstream of the kernel, not seams inside it.

## Adding a construct

Write one `ConstructSpec` class in `constructs/`, register it in `index.ts`,
add corpus lines to `kernel.test.ts`. Do not add a ViewPlugin, a decoration
set, an event handler, or a `touches` comparison anywhere else. If a new
feature seems to need one of those, it is a kernel capability; extend the
kernel once, for everyone.
