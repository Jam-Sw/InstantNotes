# Tasks: Image Handling

Streams 3 and 5 of the ten identified on `0.9.0-pre`.

## Decide first

- [ ] Resolve link mode versus vault portability (proposal, three options).
      Record the choice and the reasoning in this file — `feat-portable-vault-sync`
      reads it
- [ ] If link mode survives, decide what a note does on a device where the
      linked path does not exist

## Images settings page

- [ ] Test `SettingsImages.svelte` (210 lines, currently untested): storage
      mode switch, preview-height bounds (120-900, default 420), and the
      attachments folder button
- [ ] Confirm behavior when the attachments directory is missing or unreadable
- [ ] Confirm an unsupported file type is rejected with a legible message

## Insert from file

- [ ] Confirm the toolbar path produces the same `attachments/<name>` reference
      as paste and drop
- [ ] Confirm cancelling the file dialog is a no-op

## Contexting

- [ ] Confirm all three image modes against a note with a linked image, a copied
      image, and both

## Contract and record

- [ ] `docs/API.md`: document `import_image_file`, `allow_image_file`,
      `open_attachments_folder`
- [ ] `CHANGELOG.md`: entries for the Images page, insert-from-file, and the
      contexting modes
- [ ] `cargo test`, `npm test`, `npm run check` pass
- [ ] Move this change to `openspec/changes/archive/`
