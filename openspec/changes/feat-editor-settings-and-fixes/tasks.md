# Tasks: Editor Settings and Editor State Fixes

Streams 4 and 8 of the ten identified on `0.9.0-pre`.

## The missing regression test

The reason this unit exists rather than being folded into another.

- [ ] Add a test proving editor state does not leak between notes: open note A,
      type, switch to note B, undo, and assert B's content is untouched and A's
      text is not reachable
- [ ] Add a test proving the caret does not carry over from the previously open
      note

## Editor settings page

- [ ] Test `SettingsEditor.svelte`: the toggle persists and re-reads
- [ ] Confirm the hover-for-exact-time path works regardless of the toggle —
      the toggle controls the always-visible form only

## Links

- [ ] Confirm the modifier-held pointer cursor across the three link open modes

## Contract and record

- [ ] `docs/API.md`: no new commands expected — confirm before ticking
- [ ] `CHANGELOG.md`: entries for the Editor page and both fixes
- [ ] `cargo test`, `npm test`, `npm run check` pass
- [ ] Move this change to `openspec/changes/archive/`
