# Tasks: Image Handling

Streams 3 and 5 of the ten identified on `0.9.0-pre`.

## Decide first

- [x] Resolve link mode versus vault portability (proposal, three options).
      Record the choice and the reasoning in this file — `feat-portable-vault-sync`
      reads it
- [x] If link mode survives, decide what a note does on a device where the
      linked path does not exist

### The decision: option 2, copy on vault flush

Option 3 is rejected outright: it breaks the vault's own requirement that the
complete saved state reproduce exactly on any device
(`feat-portable-vault-sync/design.md:9-19`). Option 1 is rejected because it
removes a shipped feature — `allow_image_file` exists precisely so a note can
reference an existing external image library without InstantNotes duplicating
it into app data, and nothing about the vault requires giving that up.

Link mode survives as a live-editing convenience. What changes is the vault
boundary, not the setting: `allow_image_file` keeps referencing the original
absolute path for as long as a note is edited on the device that linked it —
today's behavior, unaffected. `flush_vault()` (`design.md:225-236`) is the
choke point that resolves the conflict: when it serializes a note whose body
references a path outside the vault, it copies the bytes into
`<vault>/attachments/`, rewrites that one reference to `attachments/<name>` in
the file it writes, and leaves the live SQLite body untouched. The vault copy
and the live copy diverge by design (`design.md:34` already anticipates this:
"the note body then differs from the vault copy"), and only the vault copy
ever leaves the device.

This answers the second question: a note with a linked image never reaches a
second device with a link at all, because the vault file synced to that device
already carries the materialized `attachments/<name>` reference the flush step
wrote. There is no broken-path case to design for on the receiving device. The
only place a stale link can appear is the *authoring* device, if the user
relinks or deletes the source file between edits — the existing behavior for
that (the asset protocol simply fails to load it) is unchanged and is a
pre-existing editor concern, not a vault one.

Recorded for `feat-portable-vault-sync`: the serializer (design.md §3.2, §6)
needs one additional rule — on flush, detect body image references that are
absolute paths outside the vault, copy those bytes into `attachments/`
alongside the pasted/copied-in ones, and rewrite the reference in the
serialized output only. No schema change; this is serializer logic, not a new
column.

## Images settings page

- [x] Test `SettingsImages.svelte` (210 lines, currently untested): storage
      mode switch, preview-height bounds (120-900, default 420), and the
      attachments folder button. `settings/SettingsImages.test.ts` (7 tests)
      covers the page; the `init()`/persistence logic it renders on top of is
      covered separately in `stores/images.svelte.test.ts` (9 tests), since
      that path can't be driven through a mounted component without breaking
      Svelte's effect context (see that file's header comment)
- [x] Confirm behavior when the attachments directory is missing or unreadable.
      `attachments_stats` (`shell/files.rs:241`) already returns `(0, 0)` on a
      missing or unreadable directory rather than failing; no gap found
- [x] Confirm an unsupported file type is rejected with a legible message.
      `image_ext` (`shell/files.rs:143`) returns a `VALIDATION` error naming the
      rejected extension, shared by both `import_image_file` and
      `allow_image_file`; no gap found

## Insert from file

- [x] Confirm the toolbar path produces the same `attachments/<name>` reference
      as paste and drop. It called a hand-written `` `![](attachments/${name})` ``
      that happened to match; `NoteEditor.svelte` now calls the same
      `attachmentMarkdown()` helper `editor/images.ts` uses for paste and drop,
      so the two paths are one path rather than two matching ones
- [x] Confirm cancelling the file dialog is a no-op. `insertImage()`
      (`NoteEditor.svelte`) returns before calling either command when the
      dialog does not resolve to a string path; no gap found

## Contexting

- [x] Confirm all three image modes against a note with a linked image, a copied
      image, and both. Added to `contexting-format.test.ts`: a linked image
      (an absolute path, not an `attachments/` reference) passes through
      unchanged in `keep` and `absolute`, is removed in `strip` same as a
      copied one, and a note carrying both resolves each independently

## Contract and record

- [x] `docs/API.md`: document `import_image_file`, `allow_image_file`,
      `open_attachments_folder`
- [x] `CHANGELOG.md`: entries for the Images page, insert-from-file, and the
      contexting modes — already present under `[0.9.0]` from `44bea94`
- [x] `cargo test`, `npm test`, `npm run check` pass — 70 Rust tests,
      339 frontend tests (up from 318), 0 type errors across 492 files
- [x] Move this change to `openspec/changes/archive/`
