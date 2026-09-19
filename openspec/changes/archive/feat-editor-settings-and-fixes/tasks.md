# Tasks: Editor Settings and Editor State Fixes

Streams 4 and 8 of the ten identified on `0.9.0-pre`.

## The missing regression test

The reason this unit exists rather than being folded into another.

- [x] Add a test proving editor state does not leak between notes: open note A,
      type, switch to note B, undo, and assert B's content is untouched and A's
      text is not reachable. `Editor.test.ts`. Mounts the real component with a
      real `EditorView` in jsdom, recovers the view with
      `EditorView.findFromDOM` (the component deliberately exposes no view of
      its own), and switches notes via `rerender` on the *same* instance — a
      fresh `render()` per note would mount a new view and trivially pass
      regardless of whether the fix works. Verified the test actually catches
      the regression: temporarily reverted `loadDoc` to reuse state across
      notes (`view.dispatch` instead of `view.setState`) and confirmed this
      test fails against it, then restored the real fix
- [x] Add a test proving the caret does not carry over from the previously open
      note. Same file, second test

## Editor settings page

- [x] Test `SettingsEditor.svelte`: the toggle persists and re-reads.
      `SettingsEditor.test.ts` (4 tests) covers the page; `editorPrefs`'s
      `init()`/persistence logic is covered separately in
      `stores/editor.svelte.test.ts` (6 tests), matching the split used for
      `imagePrefs` in `feat-image-handling` (mounting a component can't drive
      a `#loaded`-guarded singleton's read path without breaking Svelte's
      effect context under `resetModules`). Writing that store test surfaced a
      real bug: a setter called while `init()`'s settings read was still in
      flight got silently overwritten when the read resolved afterward. Fixed
      with a per-field `#touched` guard in `editor.svelte.ts`, applied to all
      three setters (`setShowExactTime`, `setZoom`, `toggleToolbar`) since
      they share the identical hazard. The same unguarded pattern exists in
      `imagePrefs` and `linkPrefs`, both outside this unit's scope; not
      touched here since those units are already archived
- [x] Confirm the hover-for-exact-time path works regardless of the toggle —
      the toggle controls the always-visible form only. Confirmed by reading
      `NoteEditor.svelte:177-179`: the `title` attribute (native hover
      tooltip) always calls `formatExact()` unconditionally; only the inline
      visible text branches on `editorPrefs.showExactTime`. No gap found

## Links

- [x] Confirm the modifier-held pointer cursor across the three link open
      modes. Mode 1 (preview + "click") was already covered by
      `linkMarkClass`'s existing tests (`cm-link-clickable` applied
      unconditionally). Modes 2 (preview + "modclick") and 3 (edit mode, any
      `openWith`) both fall back to `cm-mod-held` while the modifier is held —
      also already provably correct via the existing `linkMarkClass` tests
      (neither mode gets `cm-link-clickable`) plus the CSS pairing in
      `editor/theme.ts`, but `ModKeyCursor`, the class itself, had no test.
      Added four to `links.test.ts`: toggles on Cmd or Ctrl and clears on
      release, clears on window blur, and clears on `destroy()` so a stale
      modifier state can't leak into the next note

## Contract and record

- [x] `docs/API.md`: no new commands expected — confirmed: this unit touched
      no Rust files, `src-tauri/src/lib.rs`'s command list is unchanged
- [x] `CHANGELOG.md`: entries for the Editor page and both fixes — already
      present under `[0.9.0]` from `44bea94`
- [x] `cargo test`, `npm test`, `npm run check` pass — 92 Rust tests,
      366 frontend tests (up from 350), 0 type errors across 496 files
- [x] Move this change to `openspec/changes/archive/`
