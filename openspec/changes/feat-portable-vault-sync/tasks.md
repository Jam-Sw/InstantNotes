# Tasks: Portable Vault and Cross-Device Sync

Four stages. Each is shippable on its own and reversible. Authority does not
flip to the filesystem until stage 3, after stage 2 has proven round-tripping
against a real library.

## Stage 1: Serializer and one-way export (DONE, 0.9.0)

No behavior change. SQLite stays authoritative.

- [x] `core/src/vault/write.rs`: vault root resolution via the caller's `dest`, atomic write (tmp + fsync + rename)
- [x] `core/src/vault/serialize.rs`: `VaultNote` → Markdown + YAML frontmatter, defaults omitted
- [x] `core/src/vault/parse.rs`: Markdown + frontmatter → `VaultNote`, tolerant of missing/extra keys
- [ ] Excalidraw sidecar: `surface_data` envelope ↔ standard `.excalidraw` file. **Not applicable yet**: the whiteboard itself was lifted off this branch onto `feat/note-whiteboard` before this stage landed (see `SEQUENCE.md` unit 0 and unit 12). Its v4 columns now exist (stage 2 notes) but nothing writes them yet. Revisit when the whiteboard returns.
- [x] `instantnotes.yaml` reader/writer (tag colors, space list): `core/src/vault/manifest.rs`
- [x] Round-trip property tests: `parse(serialize(n)) == n` for every field combination. `vault::round_trip_tests` (36 combinations plus YAML-hostile/unicode/empty-body edge cases), and a real-SQLite round trip in `core/tests/store_test.rs::vault_export`
- [x] `export_vault` command + Settings action: write the whole library to a chosen folder. `commands::vault::export_vault`, Settings → Vault page
- [x] Copy `<app data>/attachments/` into `<vault>/attachments/` on export: `vault::copy_dir_recursive`

Used `serde_norway` for YAML (`serde_yaml` is unmaintained upstream; `serde_norway`
is the maintained hard-fork with an API-compatible surface). The store's
`title_is_auto` column was not previously exposed publicly; added
`Store::title_is_auto(id)` rather than widening the IPC-facing `Note` type,
since the vault is the only caller.

Known limitation, accepted for a one-way snapshot rather than blocking it:
re-exporting to a folder that already holds a previous export does not prune
files for notes deleted or retitled since the last run. Stage 2's dual-write
flush is what actually needs to solve this (it already tracks `vault_path`
per note); stage 1 just overwrites and never deletes.

Fixed before stage 1 was committed: filename collisions are now compared
case-insensitively (`vault::collision_key`). The default macOS (APFS) and
Windows filesystems treat `Notes.md` and `notes.md` as one file, so two notes
titled that way silently overwrote each other in an export. A suffixed name
that is itself taken now falls back to the full id. Also fixed:
`list_notes` had no unique tiebreaker in its `ORDER BY`, so rows tied on the
sort column could be skipped or repeated across the `LIMIT`/`OFFSET` pages
`collect_from_store` walks; `id` is now the final sort column.

## Stage 2: Dual-write (DONE, 0.9.0)

SQLite still authoritative. The vault is written but not read.

- [x] Migration v5, as design.md §5 says: `vault_path`, `file_sha`,
      `vault_dirty` on `notes`, plus `vault_tombstones` and the dirty triggers.
      An earlier draft of this list renumbered it to v4 because the whiteboard's
      v4 had been lifted off the branch. That was wrong: pre-release whiteboard
      builds had already migrated real libraries to v4 (the maintainer's own
      library among them), which the committed 0.9.0-pre then refused to open
      as too new. So the whiteboard's v4 now ships on 0.9.0 exactly as
      `feat/note-whiteboard` wrote it (columns only, unread until unit 12
      returns), and the vault is v5
- [x] `Store` gains `vault: Option<VaultState>` (`store/vault.rs`). **Drift:**
      no in-memory `dirty: HashSet`; see the next item
- [x] Dirty marking. **Drift:** SQL triggers instead of a line in each of the 13
      note-writing functions. They set `vault_dirty` in the same transaction as
      the write, so a crash can't lose it and a future writer can't forget it,
      and they cover edges, tag and Space renames, and the delete cascades.
      `last_opened_at` is not watched (§7.2). `store_test.rs` is untouched
- [x] Flush after writes. **Drift:** not inline in each command. The
      `emit_*_changed` helpers (which every write command calls) poke a
      background writer (`shell/mirror.rs`) that flushes after 300 ms of quiet
      (at most 2 s), in 50-note chunks so the store lock is never held long.
      Measured on a real 91-note library: 5 ms per note, 6 ms per single-note
      flush
- [x] Flush pending `vault_dirty` rows on startup (crash recovery), and one
      chunk on quit
- [x] Filename slug, case-insensitive collision suffix, rename-at-flush.
      Case-only renames rename the file rather than delete it on macOS. Sidecar
      rename not applicable until the whiteboard returns
- [x] Trash: move file to `trash/` on soft delete, back on restore, unlink on
      destroy (via tombstones, only while the file still holds our bytes)
- [x] Only files the mirror owns are touched: a foreign file at a note's name is
      never overwritten, and an earlier export of the same ids is adopted in
      place. The vault root is never created, so a missing drive pauses the
      mirror instead of writing to the boot disk
- [x] Attachments copied in on setup, at launch, and after each image save
- [x] Settings: vault folder picker, change, stop, status (pending / paused)
- [x] Verification command: `verify_vault` reports missing, diverged, and orphan
      files and the manifest. Proven clean on a copy of a real library
      (`vault_mirror_test.rs::a_real_library_copy_mirrors_and_verifies_clean`)
- Moved to stage 3: "Rebuild cache from vault". While SQLite is authoritative
  it would overwrite the real library from an unchecked mirror; it belongs
  with `rebuild_from_disk()` once the vault is the source of truth

## Stage 3: Filesystem authoritative

**Gate before starting:** real libraries hold whiteboard notes. The
maintainer's has 6 with canvas data in `surface_data`, written by the
pre-release whiteboard builds. Stage 2 mirrors only their body text, which is
harmless while SQLite is authoritative. Once the vault is the source of truth,
a rebuild from it would drop those canvases. Either the whiteboard returns
first (unit 12, with the sidecar), or stage 3 carries `kind` and
`surface_data` through the vault before authority flips.

- [ ] `notify` watcher with 150 ms debounce, wired into the Tauri shell layer
- [ ] Echo suppression by `file_sha` comparison per `vault_path`
- [ ] Ingest: upsert by frontmatter `id`; handle new / edited / moved / deleted
- [ ] Unknown or absent `id`: adopt the file, assign an id, write back on flush
- [ ] Reconstruct `note_tags.source` from body token presence
- [ ] Dirty-buffer safety: never overwrite the open editor; write a conflict copy
- [ ] `rebuild_from_disk()`: upsert-not-truncate so `last_opened_at` survives
- [ ] Settings: "Rebuild cache from vault" (moved here from stage 2)
- [ ] Attachments move into the vault; bodies unchanged (paths already relative)
- [ ] Benchmark rebuild at 5,000 notes; target < 500 ms
- [ ] One-time migration for existing installs, gated behind explicit confirmation

## Stage 4: Git transport

- [ ] `git2` in `instantnotes-core`; init or clone a vault repo
- [ ] Pull on launch, focus, `online`, and before push
- [ ] Debounced commit (30 s idle, blur, quit); push after commit
- [ ] Non-fast-forward: `pull --rebase`, retry push
- [ ] Markdown conflict → `<Title> (conflict from <device> <date>).md` with fresh id
- [ ] `instantnotes.yaml` conflict → per-key last-write-wins
- [ ] Excalidraw element merge: match on element id, `MAX(version, versionNonce)`, honor `isDeleted`
- [ ] PAT storage in the OS keychain (`keyring`)
- [ ] Vault `.gitignore`
- [ ] Sync status in the UI: last sync, pending changes, error state

## Docs

Bulk of this update lands when stage 3 lands, since `docs/DATA_MODEL.md` and
`README.md` describe SQLite-is-authoritative behavior that stays accurate
through stage 2. `docs/API.md` is the exception: every 0.9.0 unit ships its
own command docs as it lands, so `export_vault` was documented in stage 1
rather than held back.

- [x] `docs/API.md`: `export_vault` (stage 1's command), §12
- [x] `docs/API.md`: `get_vault_status`, `set_vault_folder`, `verify_vault`,
      `vault:status` (stage 2), §12
- [ ] `docs/API.md`: sync commands, once stage 4 adds them
- [x] `docs/DATA_MODEL.md`: migrations v4 and v5 and the mirror columns (stage 2)
- [ ] `docs/DATA_MODEL.md`: vault layout, field mapping, cache role (stage 3)
- [ ] `README.md`: "Everything lives in a local SQLite database" → vault + cache
- [x] `openspec/project.md`: Tech Stack (the vault format and its crates, stage 2)
