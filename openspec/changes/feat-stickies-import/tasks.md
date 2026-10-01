# Tasks: Import from Apple Stickies

Built on `feat/stickies-import` (its own worktree), off `0.9.0-pre` at
`917dbd3`, apart from sticky notes (13c) and agent access (13d).

## Decide first

- [x] Deterministic conversion, no model (the maintainer: "we actually dont
      need AI to do this")
- [x] Access through the folder picker: macOS 27 denies another developer's
      container with no prompt, and a picked folder is the platform's own way in
- [x] RTF parsed in portable Rust, not by AppKit: the input is Cocoa's own
      writer, the converter runs and is tested on all three CI platforms, and
      there is no `unsafe` or main-thread rule to respect
- [x] Record of what was imported in a settings key, not a table: no
      migration while two other units are open
- [x] Imported notes are stamped opened, so they do not flood Revisit
- [x] Images in web formats copied as they are, the rest converted by `sips`
- [x] Import page only where Stickies exists (macOS)

## Build

- [x] Core: `import/rtf.rs` (converter), `import/stickies.rs` (folder
      reader), `store/import.rs` (`import_notes`, `imported_ids`),
      `insert_note` shared with `create_note`, `workspace_get_or_create` and
      `setting_put` shared with their methods, `store::iso` public,
      `derive_title` drops emphasis markers
- [x] Shell: `commands/import.rs` (`stickies_location`, `scan_stickies`,
      `import_stickies`); `shell/files.rs` gains `store_image` (sniffed by
      first bytes, `sips` for the rest) and one `write_attachment` for the
      three places that store an image
- [x] Frontend: `SettingsImport.svelte`, `stickies-import.ts`,
      `folder-picker.ts` (the picker `vault-mirror.ts` now uses too), client
      and types, `SettingsView` entry on macOS, `+page.svelte` opens the Space
- [x] Docs: API.md §16, DATA_MODEL.md §6 and §8, CHANGELOG, SEQUENCE 13e

## Proof

- [x] Converter against RTF from Cocoa's own writer (`textutil`), checked in
      with its provenance: formatting, nested and numbered lists, a link,
      cp1252, an emoji pair, Cyrillic, escapes, an RTFD image with its raw
      placeholder byte, CRLF; plus the edges (emphasis and whitespace,
      skipped destinations, negative `\u`, `\uc` fallback, broken input)
- [x] Folder reader: packages only, flat files and symlinks skipped, colors
      from a real binary plist, an unreadable state file, newest first,
      picking the container
- [x] Store: dates, titles, tags, the Space, once per library, the Trash,
      destroyed notes, no empty Space, one pass end to end over the fixtures
- [x] Shell: attachment names that leave the package, links, non-images, and
      a real TIFF made by `sips` stored as a PNG
- [x] Frontend: every state of the page, what it sends, the picker's start
      folder, no Import page off macOS
- [x] 504 frontend tests (14 new), 252 Rust (32 new), clippy, fmt,
      svelte-check

## Before archiving

- [ ] The maintainer imports his own stickies: Settings > Import, Choose
      Stickies Folder…, Open, the board, Import, Show Them. This is also the
      first run of the picker grant on macOS 27, which nothing here can
      exercise without a person at the dialog
- [ ] Merge with 13c and 13d. Shared files: `SettingsView.svelte` (each adds
      a page), `+page.svelte`, `client.ts`, `types.ts`, `lib.rs` (commands),
      `docs/API.md` (§15 comes from 13d; this is §16), `CHANGELOG.md`,
      `SEQUENCE.md`, `core/src/store.rs`, `core/src/store/notes.rs` (13d adds
      `expected_updated_at` to `update_note` and `IMMEDIATE` transactions,
      which `import_notes` then gets for free)
