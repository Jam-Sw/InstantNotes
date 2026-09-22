# Tasks: Portable Vault and Cross-Device Sync

Four stages. Each is shippable on its own and reversible. Authority does not
flip to the filesystem until stage 3, after stage 2 has proven round-tripping
against a real library.

## Stage 1: Serializer and one-way export (DONE, 0.9.0)

No behavior change. SQLite stays authoritative.

- [x] `core/src/vault/write.rs`: vault root resolution via the caller's `dest`, atomic write (tmp + fsync + rename)
- [x] `core/src/vault/serialize.rs`: `VaultNote` → Markdown + YAML frontmatter, defaults omitted
- [x] `core/src/vault/parse.rs`: Markdown + frontmatter → `VaultNote`, tolerant of missing/extra keys
- [ ] Excalidraw sidecar: `surface_data` envelope ↔ standard `.excalidraw` file. **Not applicable yet**: `content_kind`/`surface_data` don't exist in the current schema; the whiteboard migration (v4) was lifted off this branch onto `feat/note-whiteboard` before this stage landed (see `SEQUENCE.md` unit 0 and unit 12). Revisit when the whiteboard returns.
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

## Stage 2: Dual-write

SQLite still authoritative. The vault is written but not read.

- [ ] Migration v4 (not v5: design.md was written assuming the whiteboard's v4
      was already in place; it was lifted off the branch before stage 1 landed,
      see `SEQUENCE.md` unit 0, so this is the next unused version number):
      `vault_path`, `file_sha`, `vault_dirty` on `notes`
- [ ] `Store` gains `vault: Option<Vault>` and `dirty: HashSet<String>`
- [ ] Mark dirty in the 13 note-writing functions
- [ ] `flush_vault()` after each command; clears `vault_dirty`
- [ ] Flush pending `vault_dirty` rows on startup (crash recovery)
- [ ] Filename slug, collision suffix, rename-at-flush, sidecar rename in lockstep
- [ ] Trash: move file to `trash/` on soft delete, back on restore, unlink on destroy
- [ ] Settings: vault path picker, enable/disable, "Rebuild cache from vault"
- [ ] Verification command: diff DB against vault, report any divergence

## Stage 3: Filesystem authoritative

- [ ] `notify` watcher with 150 ms debounce, wired into the Tauri shell layer
- [ ] Echo suppression by `file_sha` comparison per `vault_path`
- [ ] Ingest: upsert by frontmatter `id`; handle new / edited / moved / deleted
- [ ] Unknown or absent `id`: adopt the file, assign an id, write back on flush
- [ ] Reconstruct `note_tags.source` from body token presence
- [ ] Dirty-buffer safety: never overwrite the open editor; write a conflict copy
- [ ] `rebuild_from_disk()`: upsert-not-truncate so `last_opened_at` survives
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
- [ ] `docs/API.md`: sync commands, once stage 4 adds them
- [ ] `docs/DATA_MODEL.md`: vault layout, field mapping, cache role, migration v4
- [ ] `README.md`: "Everything lives in a local SQLite database" → vault + cache
- [ ] `openspec/project.md`: Tech Stack and External Dependencies
