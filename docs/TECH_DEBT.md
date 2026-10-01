# Technical debt

What an audit found and deliberately did not change, with the reason and
where each item goes in `openspec/SEQUENCE.md`. An item leaves this file
when a unit fixes it; nothing here is a TODO in the code.

Last audit: 2026-09-30, on `feat/agent-access` (off `0.9.0-pre` at
`917dbd3`). Clean at that point: no TS/Svelte import cycles, no Rust
`pub fn` referenced nowhere, every IPC command both registered and called,
no TODO/FIXME markers, clippy and svelte-check clean.

## Dependencies

**D1. Runtime advisories, all through `@excalidraw/excalidraw`.** `npm audit
--omit=dev`: 2 high, 7 moderate, 1 low, none in a package the app imports
directly except excalidraw itself.

| Advisory | Reachable? |
| --- | --- |
| `lodash-es` `_.template` code injection, array-path prototype pollution (high) | Only through excalidraw's Mermaid import (`@mermaid-js/parser` via `langium`/`chevrotain`), fed the user's own text. The app never calls lodash. |
| `nanoid` predictable output for non-integer sizes (high) | No: excalidraw asks for integer sizes. |
| `dompurify` `IN_PLACE` hook (low) | Only through Mermaid rendering. |

Fix: `npm audit fix` (no `--force`) moves `lodash-es`, `chevrotain`,
`langium`, and `dompurify` within their ranges. `nanoid` waits for an
excalidraw release; the "fix" npm offers is a downgrade to 0.17.6.
Why not now: it rewrites the shared lockfile while two units are open, and
needs a whiteboard pass (Mermaid import, board save, reopen).
Slot: its own maintenance unit, any gap between units.

**D2. Toolchain majors behind.** In range: CodeMirror, Tauri 2.11 to 2.12,
Svelte, SvelteKit, svelte-check. Majors: Vite 6 to 8, Vitest 3 to 5,
TypeScript 5.6 to 7, `vite-plugin-svelte` 5 to 7, React 18 to 19 (pinned by
excalidraw's peer range), jsdom 29 to 30.
Slot: with D1; the majors each need their own changelog read, Vite and
Vitest together.

## Structure

**S1. `src/lib/stores/library.svelte.ts` is the largest file (995 lines, 19
commits).** It already hands saving to `stores/library/save-queue.svelte.ts`.
Next extractions, in order of independence: navigation (space, tag, revisit,
graph, status filters and `#resetForNavigation`), then multi-selection. Its
behavior is covered by `library.svelte.test.ts` and
`library.agents.svelte.test.ts`, so the split can be proven, not hoped.
Why not now: the sticky-notes unit is editing this file.
Slot: the first unit after sticky notes and agent access both land.

**S2. Constants exported but used only in their own file.**
`SIDEBAR_MIN`/`MAX`/`DEFAULT` (`stores/sidebar.svelte.ts`),
`EXCALIDRAW_ENGINE` (`whiteboard/document.ts`), `EXCALIDRAW_ASSET_PATH`
(`whiteboard/excalidraw.ts`), `buildBodyFontCommands`/`buildThemeCommands`
(`commands.ts`), `assetMatcher` (`update/release-size.ts`). Live code, only
wider than it needs to be. Drop the `export` when the file is next touched.

## Tests

**T1. High-churn frontend files with no test of their own**, by commits:
`commands.ts` (10), `components/Sidebar.svelte` (9),
`components/NoteEditor.svelte` (8), `components/CommandPalette.svelte` (6,
522 lines), `stores/theme.svelte.ts` (5). Rule: the next change to one of
these adds its test in the same unit. `commands.ts` and `theme.svelte.ts`
are plain modules and cheap to cover first.

## Agents

**A1. The MCP mode is untested on Windows.** Release builds use the Windows
GUI subsystem (`main.rs`), so the binary gets no console of its own. MCP
clients spawn servers with redirected pipes, which a GUI-subsystem process
inherits, so it is expected to work, but nothing has run it there. CI builds
Windows and does not start the MCP mode.
Slot: before Windows leaves preview; one CI step that pipes
`server/discover` into the built binary settles it.

**A2. A save that loses the version race three times shows "That name is
already in use."** `CONFLICT` is one code for two meanings (a duplicate name,
a stale version), and `src/lib/errors.ts` maps it to the first. The editor
already retries and then keeps the user's text with "Restore theirs", so
this copy only appears in the rare third loss.
Fix: copy chosen by the calling context, not a second error code (API.md §14
keeps the code set closed).
Slot: with the next change to `errors.ts`.
