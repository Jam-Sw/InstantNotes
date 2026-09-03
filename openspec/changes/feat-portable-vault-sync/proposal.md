# Change: Portable Vault and Cross-Device Sync

## Why

Everything a user owns lives in one SQLite file at `<app data>/instantnotes.db`,
plus loose images under `<app data>/attachments/`. That file is the only copy.
Two consequences follow:

1. **No sync is possible.** Any sync mechanism would have to move a live SQLite
   database between machines. That is unsafe (WAL, partial writes, `store.rs:250`
   refuses non-WAL mounts outright) and produces conflicts nothing can resolve.
2. **No portability.** Without InstantNotes installed, the notes are unreadable.

Sync is not the first problem. Storage format is. Once the complete saved state
is a folder of plain files, sync stops being something we build and becomes
something the user configures — git, Syncthing, or any folder that already
replicates. This change does the storage half and ships one transport.

This also serves the Product Thesis directly. "Trust is release" does not hold
while a single unreadable file is the only copy of everything the user parked.

## What Changes

- The filesystem becomes the source of truth: a vault of Markdown files with
  YAML frontmatter, Excalidraw sidecars, and an `attachments/` directory
- SQLite is re-roled as a rebuildable cache and search index; every read path,
  FTS5 trigger, and query stays exactly as it is today
- Migration v5 adds `vault_path`, `file_sha`, `vault_dirty` to `notes`
- The 13 note-writing store functions mark notes dirty; a flush serializes them
  to disk after each command
- A `notify` watcher ingests external edits (sync tools, other editors), with
  echo suppression by content hash
- Git transport built into `instantnotes-core`: pull on launch/foreground/online,
  debounced commit and push on change
- Tag colors and space identity move to a vault-level `instantnotes.yaml`;
  UI settings stay device-local in the cache

## Non-goals (this change)

- No sync server. No hosted service, no self-hosted daemon, no delta protocol
- No automatic three-way merge of note bodies; conflicts become conflict copies
- No real-time or multi-user editing
- No encryption of the vault or the remote
- No iOS client. The vault and transport land in `instantnotes-core`, which has
  no Tauri dependency, so a future iOS client can link them; that is separate work
- No change to capture, library, tags, spaces, or any IPC command signature

## Sequencing

Units 7-10 in `openspec/SEQUENCE.md`, worked one at a time and in that order.
Unit 9 cuts 0.10.0 (the vault, no sync); unit 10 cuts 0.11.0 (git transport).

Nothing that adds a migration, a persisted field, or a write path runs alongside
these units, because they rewrite the store's write path.

Two decisions land before unit 7 and are encoded permanently by it:

- **Image link mode** (`feat-image-handling`). A linked image lives outside the
  vault by definition, so it is either dropped, materialized on export, or
  documented as opting a note out of portability
- **Whiteboards are deliberately sequenced after the vault** (SEQUENCE.md unit
  12), so the sidecar is a new file type in a format with no legacy data rather
  than a migration of user data

## Impact

Notes become readable and editable without InstantNotes, on any device, in any
editor. Backup becomes copying a folder. Sync becomes a transport choice rather
than an architecture. The cost is that the store gains a second writer — the
filesystem — which §7 of the design addresses and which the staged rollout in
`tasks.md` proves out before authority flips.

Full technical design in `design.md`.
