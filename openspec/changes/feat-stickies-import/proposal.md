# Change: Import from Apple Stickies

## Why

People who move to InstantNotes on a Mac usually have a desktop of Apple
Stickies: phone numbers, lists, half-finished thoughts, some of them years
old. Retyping them is the reason they stay where they are. Stickies keeps
them as RTF files, so bringing them in is a file conversion. It needs no AI,
and doing it deterministically means the result is exactly what was on the
sticky.

The maintainer's own note (2026-09-30) asked for this and named the
constraint: InstantNotes also ships for Windows and Linux, so a Mac-only
feature has to be built without making the app Mac-shaped.

## What Changes

- Settings gains an **Import** page (macOS only). Its first and only source
  is Apple Stickies.
- **Choose Stickies Folder…** opens the system folder picker already at
  Stickies' folder. The user clicks Open. That click is the permission: on
  macOS 27 another app's data is denied without a prompt, and a folder the
  user picks is the access the platform intends.
- The page shows every sticky as a miniature in its own color, with its
  first lines and date. The user picks which to bring in (all, by default)
  and which Space to file them in (`Apple Stickies`, editable, or none).
- Import copies each sticky into a note: bold, italic, strikethrough, links,
  bulleted and numbered lists (nested), line breaks, and images. Original
  created and modified dates are kept. `#words` become tags, as anywhere in
  the app. Nothing inside Stickies is changed.
- Importing again brings in only the stickies not imported yet.
- A derived title no longer carries emphasis markers (a first line of
  `**Groceries**` titles the note "Groceries", not "Groceries**") or an
  image path (a note opening with a screenshot takes its first line of words),
  for imported and typed notes alike.

## Decisions

- **Deterministic.** No model sees the stickies. Tagging an import with
  existing tags is what a connected agent can do afterwards, through the
  tools it already has; it is not part of importing.
- **Neutral core, Mac edges.** The RTF converter and the Stickies folder
  reader are plain Rust in `instantnotes-core`, built and tested on all
  three CI platforms. Only three things are macOS: where Stickies lives,
  converting TIFF/HEIC images with the system's `sips`, and the Settings
  entry. That is the answer to the maintainer's question: keep platform
  facts at the edges and everything that decides behavior testable
  everywhere.
- **Copy, never move.** The importer only reads Stickies' folder.
- **No migration.** Which stickies became which notes is one settings key,
  `import.stickies`, written in the same transaction as the notes. Two
  other units are open on `0.9.0-pre`, and a schema bump here would make a
  library opened by this build unreadable by theirs.
- **Imported notes are not Revisit captures.** They are stamped as opened at
  import time. Revisit means "things I captured and never came back to", and
  forty stickies arriving at once would bury that list; the import's Space
  is where to go through them.
- **One transaction.** All chosen stickies land, or none do. Images are
  copied first; if the transaction fails, they are unreferenced and the
  existing attachment cleanup removes them after its grace period.

## Impact

- Core: `src-tauri/core/src/import/` (new: `rtf.rs`, `stickies.rs`),
  `store/import.rs` (new), `store/notes.rs` (`insert_note`, the one insert
  path, now shared with `create_note`), `store.rs` and `store/settings.rs`
  (helpers usable inside a transaction), `domain.rs` (`derive_title`),
  `Cargo.toml` (`plist`, already in the app's dependency graph through Tauri).
- Shell: `src-tauri/src/commands/import.rs` (new), `shell/files.rs` (one
  way to write an attachment, plus `store_image`), `lib.rs`.
- Frontend: `components/settings/SettingsImport.svelte`, `stickies-import.ts`,
  `folder-picker.ts` (new; `vault-mirror.ts` uses it too),
  `SettingsView.svelte`, `routes/+page.svelte`, `api/client.ts`,
  `api/types.ts`.
- Docs: `docs/API.md` §16, `docs/DATA_MODEL.md` (the settings key),
  `CHANGELOG.md`, `openspec/SEQUENCE.md`.
