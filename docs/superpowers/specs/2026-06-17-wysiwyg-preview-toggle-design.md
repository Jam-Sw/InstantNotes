# WYSIWYG Preview Toggle Design

**Date:** 2026-06-17
**Branch target:** `feat/wysiwyg-preview`
**Status:** Approved — pending implementation plan

---

## Summary

When the Aa toolbar is **closed**, the editor switches to WYSIWYG mode: markdown syntax markers are hidden and formatting is rendered in place (bold looks bold, bullet points show as `•`, blockquotes indent). The document remains fully editable. When Aa is **open**, the editor returns to source mode (markers visible), matching the current behaviour.

---

## Architecture

### New file: `src/lib/wysiwyg.ts`

A self-contained CM6 extension bundle. Nothing outside this file needs to know the internal mechanism.

**Exports:**

| Export | Type | Purpose |
|---|---|---|
| `setPreviewMode` | `StateEffect<boolean>` | Dispatched to CM6 to switch modes |
| `previewModeField` | `StateField<boolean>` | Tracks current mode inside CM6 |
| `wysiwygExtension()` | `Extension[]` | Full extension array to add to EditorState |

`wysiwygExtension()` returns: `[previewModeField, wysiwygViewPlugin, wysiwygKeymap]`

Note: `replace` decorations are atomic in CM6 by default — no separate `atomicRanges` facet is needed.

### Mode flow

```
editorPrefs.toolbarOpen (Svelte rune)
  → passed as prop previewMode={!editorPrefs.toolbarOpen} to Editor.svelte
  → $effect dispatches setPreviewMode StateEffect into CM6 view
  → previewModeField updates
  → wysiwygViewPlugin rebuilds decorations on next view update
```

### Files changed

| File | Change |
|---|---|
| `src/lib/wysiwyg.ts` | **New** — full WYSIWYG extension |
| `src/lib/components/Editor.svelte` | Add `previewMode` prop; add `wysiwygExtension()` to CM6 state; `$effect` dispatches `setPreviewMode` |
| `src/lib/components/NoteEditor.svelte` | Pass `previewMode={!editorPrefs.toolbarOpen}` to `<Editor>` |

---

## Inline Mark Hiding

The ViewPlugin scans visible ranges via the lezer syntax tree (already parsed by `@codemirror/lang-markdown` with `base: markdownLanguage`). In preview mode it issues:

| Markdown | Node type | Action |
|---|---|---|
| `**bold**` | `StrongEmphasis` / `EmphasisMark` | `replace({})` each `EmphasisMark` token |
| `*italic*` / `_italic_` | `Emphasis` / `EmphasisMark` | `replace({})` each `EmphasisMark` token |
| `~~strike~~` | `Strikethrough` / `StrikethroughMark` | `replace({})` each mark token |
| `` `code` `` | `InlineCode` / `CodeMark` | `replace({})` each backtick node |
| `[text](url)` | `Link` | `replace({})` on `[`, on `](`, and on `url)` |

No new visual styles are needed for inline content — the existing `markdownHighlightSpec` already renders `StrongEmphasis` content as bold, `Emphasis` as italic, etc. Hiding the markers is sufficient.

`replace` decorations are atomically navigable by default in CM6: the cursor cannot land inside a hidden marker range.

---

## Block-Level Handling

### Bullet lists (`- item`, `* item`, `+ item`)

For each `ListItem` node:
1. `Decoration.replace({ widget: new BulletWidget() })` covering `[line.from, line.from + markerLen]` — replaces the `- ` prefix with the widget in one step

`BulletWidget` renders `<span class="cm-wysiwyg-bullet">•</span>` and is uneditable (`ignoreEvent` returns `true`).

### Ordered lists (`1. item`, `2. item`)

Same approach: `Decoration.replace({ widget: new NumberWidget(n) })` covering the `1. ` prefix, where `n` is read from the ordered list item's syntax node. Renders `<span class="cm-wysiwyg-number">N.</span>`.

### Blockquotes (`> text`)

For each `Blockquote` line:
1. `Decoration.replace({})` on `> ` prefix (2 chars)
2. `Decoration.line({ class: "cm-wysiwyg-blockquote" })` on the line — adds left border + subdued color via CSS

### Headings — intentionally excluded

`#` is reserved for tags in InstantNotes. `ATXHeading` nodes are never decorated. A `#word` sequence always stays as a tag, never renders as a heading.

### CSS additions (in `Editor.svelte` `<style>` block, scoped via `:global` inside `.editor-container`)

```css
:global(.cm-wysiwyg-bullet),
:global(.cm-wysiwyg-number) {
  color: var(--text);
  margin-right: 0.3em;
  user-select: none;
}

:global(.cm-wysiwyg-blockquote) {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  color: var(--text-secondary);
  font-style: italic;
}
```

---

## Smart Backspace for Block Elements

A custom `keymap` entry with higher priority than `defaultKeymap`:

**Key:** `Backspace`
**Guard:** only runs when `previewModeField` is `true`

**Logic:**

```
1. cursor = view.state.selection.main (must be empty — no selection)
2. line = view.state.doc.lineAt(cursor.from)
3. Match line.text against block marker patterns:
     /^(>\s|[-*+]\s|\d+\.\s)/
4. markerEnd = line.from + match[0].length
5. If cursor.from !== markerEnd → return false (let default handle it)
6. Dispatch: changes { from: line.from, to: markerEnd, insert: "" }
7. Return true (event consumed)
```

This converts a bullet/blockquote line to a plain paragraph when the user presses Backspace at the visual start — identical to Word/Notion behaviour.

If there IS a selection (non-empty), we return `false` and let the default keymap delete the selection normally.

---

## Scope Boundary (v1 exclusions)

These are intentionally out of scope and can be added in a future pass:

- **Nested lists** — outer list item renders; nested indentation stays raw
- **Fenced code blocks** (` ``` ` ... ` ``` `) — left as source; existing syntax highlight is adequate
- **Tables** — too complex, rare in notes
- **Images** (`![](url)`) — would require image loading; deferred

---

## Test coverage

No new Vitest unit tests are required for the CM6 ViewPlugin (CM6 extensions don't export pure functions to unit test easily). The smart Backspace handler logic should be extracted into a pure helper and unit tested:

```typescript
// wysiwyg.ts
export function blockMarkerRange(lineText: string, lineFrom: number): { from: number, to: number } | null
```

This is testable without CM6 — given a line string and line start offset, returns the marker range or null.

The existing `npm test` suite (92 frontend tests) must remain green after the change.
