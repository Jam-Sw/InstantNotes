# Change: Lightweight Markdown Styling and a Format Toolbar

## Why
The note body is plain text today. People want to stylize text and have notes
look structured, but InstantNotes should not become a markdown editor, and it
must not require knowing markdown to benefit from it. One constraint shapes
everything: `#` already means a tag in InstantNotes (inline `#tag` highlighting
and the tag index), so markdown headings are deliberately out - `#title` stays a
tag, never a heading. The editor zoom from the previous WIP also needs finishing
and persisting, and edits should visibly confirm they are saved.

## What Changes
- Live markdown styling in the editor, markers kept visible: bold, italic,
  strikethrough, inline code, fenced code, blockquotes, and lists/links are
  styled inline as you type, via `@codemirror/lang-markdown` plus a custom
  highlight style. Headings are intentionally not styled, and the existing
  `#tag` highlighting is preserved and takes precedence, so a tag is never
  rendered as a heading.
- A format toolbar revealed by a toggle in the editor toolbar: Bold, Italic,
  Strikethrough, Code, Quote, List, Link. Each wraps or prefixes the current
  selection with the right markdown so users get styling without typing syntax.
  Hidden by default; the open/closed state persists.
- Formatting keyboard shortcuts wired to the same actions: Cmd-B, Cmd-I,
  Cmd-E (code), Cmd-K (link).
- Finish the editor zoom: keep Cmd-+ / Cmd-- / Cmd-0, add A- / A+ / reset
  controls to the toolbar, and persist the level across notes and restarts.
- Persist the zoom level and toolbar-open state through the existing settings
  store, restored on launch.
- Clearer save feedback: the status bar shows Saving… then Saved so edits never
  feel lost.

## Out of Scope
- Markdown headings via `#` (reserved for tags) and any `#`-based heading UI.
- A markdown preview/render pane or a raw/preview mode switch.
- Clickable task checkboxes (`- [ ]`): tracked as a separate follow-up issue and
  shipped on its own branch.

## Impact
- Frontend: `src/lib/components/Editor.svelte` (markdown highlight extension,
  selection-formatting commands, zoom font scaling), a small format toolbar in
  `src/routes/+page.svelte`, the editor-zoom WIP, and a small editor-prefs store
  persisting through the settings API client.
- New dependencies: `@codemirror/lang-markdown`, `@codemirror/language`,
  `@lezer/highlight` (standard CodeMirror packages, no custom parser).
- Pure selection-formatting helpers are unit-tested (Vitest); a test pins that
  `#tag` stays a tag and is never styled as a heading.
- The Rust core is untouched; persistence reuses the existing get_setting /
  set_setting commands, as the theme store already does.
