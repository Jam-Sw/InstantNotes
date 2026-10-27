# Tasks: Linked image folders

## Rust

- [x] `src-tauri/src/shell/files.rs`: `allow_image_file` removed; `allow_linked_images`, `pick_linked_image`, `linked_image_decision`, `LinkedImageState` and `LINKED_FOLDERS_KEY` added; `src-tauri/src/lib.rs` manages the state and registers both commands. Tests: `files::tests` (the decision for the vault, an allowed folder, an unknown folder, a declined folder; `canonical_image` on an existing image, a text file, a missing file, a relative path, a folder). Ran: `cargo test -p instantnotes --lib files::`
- [x] `src-tauri/src/shell/files.rs`: the dialog in design section 3. Test: `the_dialog_lists_five_folders_and_counts_the_rest`

## Frontend

- [x] `src/lib/components/Editor.svelte` `loadDoc`: one `allowLinkedImages(linked)` call. Test: `Editor.test.ts` mocks `allowLinkedImages`
- [x] `src/lib/components/NoteEditor.svelte` `insertImage`: link mode uses `pickLinkedImage()`, copy mode keeps the picker and `importImageFile`. Test: `NoteEditor.test.ts` mocks `pickLinkedImage`
- [x] `src/lib/stores/images.svelte.ts`: `imagePrefs.linkedFolders`, `removeLinkedFolder(path)`, re-read on `settings:changed`. Test: `src/lib/stores/images.svelte.test.ts`
- [x] `src/lib/components/settings/SettingsImages.svelte`: "Linked folders" group with Remove buttons and the empty sentence, hidden on the web. Test: `SettingsImages.test.ts` lists a folder, removes it, shows the empty sentence

## Docs

- [x] `docs/API.md` section 8: the `allow_image_file` row and paragraphs replaced by `allow_linked_images` and `pick_linked_image`; section 7 names `images.linkedFolders`. Check: `grep -rn allow_image_file src src-tauri docs` prints nothing
- [x] `CHANGELOG.md` `[Unreleased]` Security entry naming `allow_linked_images`, `pick_linked_image`, `images.linkedFolders` and issue #82

## Checks

- [x] `src-tauri/tauri.conf.json`: not edited; the asset scope is still `$APPDATA/attachments/**`
- [x] `.claude/scripts/check.sh`: svelte-check, vitest, cargo test, clippy, rustfmt, wasm, knip in both modes. Ran at `daa78d6`, all eight pass
