# Tasks: Portable Vault and Cross-Device Sync

Four stages. Each is shippable on its own and reversible. Authority does not
flip to the filesystem until stage 3, after stage 2 has proven round-tripping
against a real library.

## Stage 1 — Serializer and one-way export

No behavior change. SQLite stays authoritative.

- [ ] `core/src/vault/mod.rs`: vault root resolution, atomic write (tmp + fsync + rename)
- [ ] `core/src/vault/serialize.rs`: `Note` → Markdown + YAML frontmatter, defaults omitted
- [ ] `core/src/vault/parse.rs`: Markdown + frontmatter → `Note`, tolerant of missing/extra keys
- [ ] Excalidraw sidecar: `surface_data` envelope ↔ standard `.excalidraw` file
- [ ] `instantnotes.yaml` reader/writer (tag colors, space list)
- [ ] Round-trip property tests: `parse(serialize(n)) == n` for every field combination
- [ ] `export_vault` command + Settings action: write the whole library to a chosen folder
- [ ] Copy `<app data>/attachments/` into `<vault>/attachments/` on export

## Stage 2 — Dual-write

SQLite still authoritative. The vault is written but not read.

- [ ] Migration v5: `vault_path`, `file_sha`, `vault_dirty` on `notes`
- [ ] `Store` gains `vault: Option<Vault>` and `dirty: HashSet<String>`
- [ ] Mark dirty in the 13 note-writing functions
- [ ] `flush_vault()` after each command; clears `vault_dirty`
- [ ] Flush pending `vault_dirty` rows on startup (crash recovery)
- [ ] Filename slug, collision suffix, rename-at-flush, sidecar rename in lockstep
- [ ] Trash: move file to `trash/` on soft delete, back on restore, unlink on destroy
- [ ] Settings: vault path picker, enable/disable, "Rebuild cache from vault"
- [ ] Verification command: diff DB against vault, report any divergence

## Stage 3 — Filesystem authoritative

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

## Stage 4 — Git transport

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

Updated when stage 3 lands, not before — both currently describe shipped
behavior accurately.

- [ ] `docs/DATA_MODEL.md`: vault layout, field mapping, cache role, migration v5
- [ ] `docs/API.md`: new vault and sync commands
- [ ] `README.md`: "Everything lives in a local SQLite database" → vault + cache
- [ ] `openspec/project.md`: Tech Stack and External Dependencies
