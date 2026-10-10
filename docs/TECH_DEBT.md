# Technical debt

What an audit found and deliberately did not change, with the reason and
where each item goes in `openspec/SEQUENCE.md`. An item leaves this file
when a unit fixes it; nothing here is a TODO in the code.

Last audit: 2026-10-03, on `0.9.3-pre`. Clean at that point: knip reports
no unused file, export, or dependency; a `-W dead-code -W unused` build of
the Rust workspace is warning-free; every registered IPC command has a
`client.ts` wrapper with a caller outside the tests, and no wrapper names a
command that is not registered; clippy, fmt, svelte-check, and both test
suites clean. S1, S2, and the `commands.ts` and `theme.svelte.ts` half of
T1 left this file in that pass, and A2 in the follow-up. `knip --production`
is clean too: the files whose exports only their own tests call are listed
under `ignoreIssues` in `knip.json`, which also leaves out the installer kit's
copied agreement files.

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

## Tests

**T1. High-churn frontend components with no test of their own**, by
commits: `components/Sidebar.svelte` (9), `components/NoteEditor.svelte`
(8), `components/CommandPalette.svelte` (6, 522 lines). Rule: the next
change to one of these adds its test in the same unit. (`commands.ts` and
`stores/theme.svelte.ts`, the plain modules this item also named, now have
`commands.test.ts` and `theme.svelte.test.ts`.)

## Agents

**A1. The MCP mode is untested on Windows.** Release builds use the Windows
GUI subsystem (`main.rs`), so the binary gets no console of its own. MCP
clients spawn servers with redirected pipes, which a GUI-subsystem process
inherits, so it is expected to work, but nothing has run it there. CI builds
Windows and does not start the MCP mode.
Slot: before Windows leaves preview; one CI step that pipes
`server/discover` into the built binary settles it.
