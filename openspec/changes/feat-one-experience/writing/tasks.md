# Tasks: The writing surface

- [x] `markdown-format.ts`: `heading` cycle, with tests (331d69e)
- [x] `Editor.svelte`: `undo`, `redo`, `canUndo`, `canRedo` (331d69e)
- [x] `editor.svelte.ts`: `sourceMode`; `toolbarOpen` default true, stored
      false respected; tests (331d69e)
- [x] `Icon.svelte`: the toolbar's icons join the set (331d69e)
- [x] `FormatToolbar.svelte`: the row of design §1, the active state, tests
      (331d69e, e34194d)
- [x] `NoteEditor.svelte`: toolbar decoupled from the mode; spacing of §3;
      `previewMode={!editorPrefs.sourceMode}` (331d69e: the toolbar shows on
      `editorPrefs.toolbarOpen`, `previewMode={!editorPrefs.sourceMode}`,
      `.tag-bar` 6px above and `2px 0 8px`, the body's
      `calc(12px * var(--density))` top; `FormatToolbar.test.ts` and
      `NoteEditor.test.ts`: 9 passed)
- [x] `commands.ts`: `view.markdownSource`, `view.toolbar` (331d69e)
- [x] Visual pass on the toolbar and header (173da22)
- [ ] Before and after screenshots, dark and light, on Linux
      (`kwin_wayland`, `tauri-driver`)
- [x] CHANGELOG lines; `docs/DATA_MODEL.md` §8 for the key (331d69e)
- [ ] In the app: typing with the toolbar, bold pressed while in bold text,
      undo and redo, heading cycle, the Markdown toggle, zoom. Remains: a
      person at the app; the logic is covered by `FormatToolbar.test.ts`,
      `markdown-format.test.ts` and `editor.svelte.test.ts`
