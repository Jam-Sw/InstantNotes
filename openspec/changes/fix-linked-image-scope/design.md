# Design: Linked image folders

## 1. Rust commands (`src-tauri/src/shell/files.rs`)

- Remove `allow_image_file`. `allow_linked_images(state, linked, app, paths: Vec<String>) -> CmdResult<Vec<String>>`
  returns the paths now allowed.
- `pick_linked_image(state, app) -> CmdResult<Option<String>>` runs the native picker
  with an images filter on the Rust side. The chosen file is allowed at once and
  its folder is added to the allowed folders. Nothing is asked, because the
  chooser's answer cannot come from note content.
- `allow_linked_images` checks each path: absolute, image extension, existing
  file. It then canonicalizes the path, so symlinks are resolved and the final
  location decides. Both the path as the note names it and the canonical path
  are allowed in the asset scope, so the webview's request matches either way.
- A canonical path under the vault root (`Store::vault_root`) or under a folder
  in `images.linkedFolders` is allowed without asking. That setting is a JSON
  array of absolute folder strings and is not synced. Roots and allowed folders
  are canonicalized before the comparison.
- The remaining paths are grouped by parent folder. Folders declined earlier in
  this app run are skipped. The declined set is a `Mutex<HashSet<PathBuf>>` in
  managed state as `LinkedImageState`.
- For the rest, one native dialog is shown with `tauri_plugin_dialog`,
  `blocking_show` and the warning kind. Its text is in section 3.
- Allow adds the folders to `images.linkedFolders`, emits `settings:changed` and
  allows the files. Keep hidden adds the folders to the declined set.

## 2. Decision function

```rust
fn linked_image_decision(canonical: &Path, roots: &[PathBuf], allowed: &[PathBuf], declined: &HashSet<PathBuf>) -> LinkedImage
```

`LinkedImage` is `Allow`, `Ask(folder)` or `Skip`. The function is pure and
unit-tested in `files.rs`, as are `folder_lines` (the dialog's folder list) and
`canonical_image` (the path checks).

## 3. Dialog text

- Title: "Show images from outside your library?"
- Message: "This note links to images in:", then up to 5 folders (then "+N more"),
  then "InstantNotes loads images only from its attachments, your vault folder
  and folders you allow. Allowing a folder lets any note show images from it,
  now and later. Settings > Images lists them."
- Buttons: "Allow" and "Keep hidden".

## 4. Setting

`images.linkedFolders` is a device setting. `imagePrefs.linkedFolders` in
`src/lib/stores/images.svelte.ts` mirrors it. `removeLinkedFolder(path)` removes
one entry, and the store re-reads on `settings:changed`.

## 5. Frontend call sites

- `src/lib/api/client.ts`: add `allowLinkedImages(paths: string[]): Promise<string[]>`
  and `pickLinkedImage(): Promise<string | null>`. Remove `allowImageFile`.
- `Editor.svelte` `loadDoc`: one `allowLinkedImages(linked)` call in place of one
  call per path.
- `NoteEditor.svelte` `insertImage`: in link mode call `pickLinkedImage()`. In
  copy mode keep the frontend picker and `importImageFile`.
- `SettingsImages.svelte`: the "Linked folders" group, hidden on the web.

## 6. What stays

The asset scope in `tauri.conf.json` stays `$APPDATA/attachments/**`.
