# Tasks: Vault Sync

## Engine (`instantnotes-core`)

- [x] `vault/reconcile.rs`: `decide` (the eight rules of design §4), `equivalent`, `derived_id`, `conflict_title`. Every rule has a unit test
- [x] `vault/scan.rs`: `list_vault`, `Stamp`, `Settled` (2 s settle against the newest mtime, never the local clock), the vault marker
- [x] `vault/transport.rs`: `Transport`, `Reach`, `Folder`, `open` by name
- [x] `vault/sync.rs`: `Syncer::cycle` (pull, scan, ingest in chunks of 50, removals, manifest, flush, attachments, push) against `Mutex<Store>`
- [x] `vault/manifest.rs`: `merge_manifest`, three-way per key
- [x] `vault/surface.rs`: `canvas_surface`, `surface_from_file`; `sheet.rs`: `Sheet::from_csv` (RFC 4180, keeps the note's column widths)
- [x] `store/vault_sync.rs`: `ingest_vault_files`, `ingest_vault_removals` (with the removal guard), `sync_vault_manifest`, `confirm_vault_removals`, `record_vault_sync`
- [x] Files read in are recorded with `vault_dirty` 0, and rewritten only when the file was not canonical
- [x] A file whose bytes equal the recorded base is not parsed (an adopted plain file between adoption and write-back)
- [x] Duplicated ids (sync tool conflict files, hand copies) become conflict copies with derived ids
- [x] Plain Markdown files are adopted with derived ids; foreign frontmatter is reported, never adopted
- [x] `store/vault.rs`: the flush guard (defer instead of overwrite), the marker on `flush_vault` and `verify_vault`, the marker created by `configure_vault`, `vault.manifestBase` cleared with the folder, `vault.transport`
- [x] Stage 2's in-place adoption of an earlier export now requires the file to be equivalent to the note

## Shell and app

- [x] `shell/mirror.rs`: the sync thread replaces the flush-only writer; local writes trigger a cycle after 300 ms of quiet, otherwise every `interval`; the `Syncer` follows the configured folder and transport
- [x] Events: `vault:synced { noteIds }`, plus `notes:changed`, `tags:changed`, `workspaces:changed`, `vault:status` after a cycle
- [x] `confirm_vault_removals` command
- [x] Attachments copied both ways each cycle; the image-save paths poke a cycle instead of copying on their own
- [x] Library and stickies adopt `vault:synced` the way they adopt an agent's write
- [x] Settings > Vault: offline / held / problem / syncing / up to date, conflicts count, "Move N notes to Trash", copy rewritten for sync

## Tests

- [x] `core/tests/vault_sync_test.rs`: two devices on one folder. Travel, echo, edit back, both-sides conflict, trash/restore/destroy, rename, tags and Spaces merge, unmounted share, removal guard, adoption (single and simultaneous), external edit, broken frontmatter, duplicate file, joining device and Revisit, sheet and whiteboard surfaces, attachments, flush guard
- [x] Unit tests in `reconcile`, `scan`, `transport`, `manifest`, `surface`, `sheet`
- [x] `vault_mirror_test.rs`: a missing folder that comes back empty stays paused until the marker returns
- [x] Frontend: `describeVaultStatus`, `parseVaultSynced`, the Settings card, the open note adopting `vault:synced`

## Web mode (`instantnotes-server`)

- [x] `Syncer::cycle` takes a `StoreLock` (implemented for `Mutex<Store>`), so the server drives it through `Mutex<Library>`
- [x] `INSTANTNOTES_VAULT_ROOT`: each person's library syncs with `<root>/<library folder>`; unset changes nothing
- [x] The folder is never created; a missing folder leaves the library working unsynced
- [x] First cycle before the first request after opening; then a 1 s tick for open libraries, after an API change or every transport interval; a connected page keeps its library open
- [x] `notes:changed`, `vault:synced`, `tags:changed`, `workspaces:changed` reach the person's event stream
- [x] Tests (`server/tests/isolation_test.rs`): one person's vault never reaches another's library (including a `sub` of `../<other>`), a missing folder, no root, edits both ways with a desktop edit arriving on the stream
- [x] Tests (`core/tests/vault_sync_test.rs`): empty library + full folder, full library + empty folder, two full libraries, one note edited on both sides before the first meeting
- [x] End to end with a throwaway Pocket ID: 20 desktop notes appear in the browser, a browser edit reaches the folder and the desktop library, a desktop edit appears in the open note without a reload

## Docs

- [x] `docs/API.md` §12: status fields, `confirm_vault_removals`, `vault:synced`, §12.3 Sync
- [x] `docs/DATA_MODEL.md` §10, §10.1: column meanings now include "read", `vault.manifestBase`, `vault.transport`, the marker
- [x] `README.md`: the vault feature and the local-storage line
- [x] `CHANGELOG.md` `[0.10.0]`
- [x] `feat-portable-vault-sync/tasks.md`: stage 3 items this change delivers, marked with where

## In-app checks (open)

- [ ] Two devices (Linux and the Mac) on one network share: a note made on one appears on the other within a few seconds
- [ ] Unmount the share on one device: Settings says Offline, typing continues, and the edits arrive after remounting
- [ ] Edit the same note on both while one is offline: both versions survive, one tagged `conflict`
- [ ] Check vault comes back clean on both devices after a day of ordinary use
