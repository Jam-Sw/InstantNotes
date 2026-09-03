# Design: Portable Vault and Cross-Device Sync

Technical design for `proposal.md`. Supersedes the earlier
`docs/PORTABLE_VAULT_AND_SYNC_SPEC.md`, which is deleted by this change; its
rejected positions are recorded with reasons in §13.

## 1. Requirements

The complete saved state must live in an open, app-independent format that any
device or transport can carry and reproduce exactly:

- note body text
- whiteboard canvases
- tags and spaces
- attachments
- timestamps and status flags

The format must be readable and editable with InstantNotes absent. Sync must
cost nothing upfront or ongoing, and must reach Linux, macOS, and eventually iOS.

## 2. Decisions

**D1. The filesystem is authoritative. SQLite is a rebuildable index.**
Writes go to disk first, then to the cache. Deleting the cache loses nothing.
This is what makes the vault portable and what makes any transport work.

**D2. No sync server is written.**
Ordering and replication are the transport's job. Git and Syncthing already do
this correctly. Writing a delta-sync daemon means reimplementing them worse,
and a home server is not zero ongoing cost.

**D3. Git is the built-in transport.**
It is the only free transport that reaches all three platforms, needs no server,
and requires no Apple entitlements. It also supplies version history and
undelete. Folder-sync tools work by construction on the same layout.

**D4. The cache database stays outside the vault.**
`Store::open` hard-fails when `PRAGMA journal_mode = WAL` does not stick
(`store.rs:250`), and cloud and network mounts break WAL routinely. A live
SQLite file inside a synced folder is also the classic way to corrupt one. The
cache stays at `<app data>/instantnotes.db`, where it is today.

## 3. Vault layout

```
<vault>/
├── Distributed Systems Notes.md
├── Q3 Planning Board.md              # kind: whiteboard
├── Q3 Planning Board.excalidraw      # sidecar, renamed in lockstep
├── attachments/
│   └── a1b2c3d4-e5f6-7890.png
├── trash/
│   └── Old Draft.md
└── instantnotes.yaml
```

Notes sit at the vault root, not in a `notes/` subdirectory. This is deliberate:
bodies already reference images as `attachments/<name>` (`shell/files.rs:82`),
and that relative path resolves correctly only when the note and the
`attachments/` directory are siblings. Root placement means the migration
rewrites zero note bodies.

Known limitation: a note in `trash/` resolves `attachments/…` one level too deep,
so images in trashed notes do not render in external viewers. Trash is transient
and restoring fixes it. Accepted rather than rewriting bodies on trash.

### 3.1 Filenames

`<title-slug>.md`, slug derived from the note title. On collision, append the
first six characters of the note `id`.

The filename is a label, not an identity. Identity is the `id` in frontmatter,
which is why an external rename, a git rename, or a Syncthing delete-plus-create
all reconcile to the same note.

Renames are applied at flush time (§6), not per keystroke, so a note with an
auto-derived title settles within a save cycle instead of churning.

### 3.2 Note file format

````markdown
---
id: 018f6c3a-8b29-7c10-9824-3a2e1d0f5b6a
created: 2026-09-03T19:00:00.000000Z
updated: 2026-09-03T19:15:00.000000Z
pinned: true
tags: [distributed-systems, consensus]
spaces: [Engineering]
---
# Consensus Protocols

Notes on Paxos and Raft. #consensus
````

**Every field is omitted when it equals its default.** A plain note carries only
`id`, `created`, and `updated`. Frontmatter noise defeats the purpose of the
format being human-readable.

`title` is the one non-obvious rule: it is written **only when the user set it
explicitly**. `title_is_auto` is then redundant — its value is exactly
`frontmatter.title.is_none()`, because an auto title is by definition
`derive_title(body)` (`notes.rs:12`, `notes.rs:89`). One field, no redundancy,
fully lossless.

Spaces use the product term `spaces`, not the storage term `workspaces`. The
vault is user-facing, and the glossary in `openspec/project.md` puts the
UI/storage boundary at exactly this kind of surface.

### 3.3 Whiteboard sidecars

`surface_data` currently holds the app's own envelope,
`{v, engine, data:{elements, appState, files}}` (`whiteboard/document.ts`).
The sidecar writes the **standard Excalidraw file format** instead:

```json
{ "type": "excalidraw", "version": 2, "source": "instantnotes",
  "elements": [], "appState": {}, "files": {} }
```

so the file opens on excalidraw.com and in the desktop app. The `v`/`engine`
envelope is reconstructed on ingest. Embedded images in `files` are extracted to
`attachments/` and referenced by id rather than inlined as data URLs.

### 3.4 `instantnotes.yaml`

Holds what has no note to live on:

```yaml
tags:
  consensus: { color: "#7aa2f7", created: 2026-07-02T09:14:00Z }
spaces:
  - { name: Engineering, created: 2026-07-02T09:10:00Z }
```

Spaces must be listed explicitly because an empty space has no note referencing
it, and empty spaces are legitimate and always visible
(`docs/superpowers/specs/2026-07-10-spaces-design.md`). Without this file they
would vanish on rebuild.

Tag and space **identity is the name**, which is already unique in both tables.
Their row `id`s are cache-local and may be regenerated on rebuild. Nothing
outside the cache persists a tag or space id — settings hold only UI
preferences.

## 4. Field mapping

Every column has a defined home. Nothing is dropped.

| `notes` column | Vault location | Note |
| --- | --- | --- |
| `seq` | not persisted | cache-only; FTS `content_rowid` |
| `id` | frontmatter `id` | stable identity |
| `title` | frontmatter `title` | present only when user-set |
| `title_is_auto` | implied | `= title absent` (§3.2) |
| `body` | Markdown body | after the frontmatter block |
| `content_kind` | frontmatter `kind` | omitted when `document` |
| `surface_data` | `<slug>.excalidraw` | §3.3 |
| `created_at` | frontmatter `created` | |
| `updated_at` | frontmatter `updated` | authoritative; mtime is not |
| `last_opened_at` | not persisted | device-local, §7 |
| `is_pinned` | frontmatter `pinned` | omitted when false |
| `is_archived` | frontmatter `archived` | omitted when false |
| `is_deleted` | file location | the note lives in `trash/` |
| `deleted_at` | frontmatter `deleted` | present only in `trash/` |

| Other state | Vault location |
| --- | --- |
| `note_tags` | frontmatter `tags` |
| `tags.color`, `tags.created_at` | `instantnotes.yaml` |
| `note_workspaces` | frontmatter `spaces` |
| `workspaces` | `instantnotes.yaml` |
| `settings` | not persisted — device-local UI preferences |
| `notes_fts` | not persisted — derived |
| attachments | `attachments/` (moved from `<app data>`) |

`note_tags.source` is reconstructed, not stored: a tag is `inline` when its
token appears in the body, `manual` otherwise. This reproduces current behavior
exactly, since `update_note` already deletes and re-derives inline edges on
every body change (`notes.rs:120-137`).

## 5. Schema migration v5

Additive only. Migration v3 dropped the unused sync scaffolding with the note
that "a real sync feature will design its own schema when it lands"
(`store.rs:102`); this is that schema.

```sql
ALTER TABLE notes ADD COLUMN vault_path  TEXT;
ALTER TABLE notes ADD COLUMN file_sha    TEXT;
ALTER TABLE notes ADD COLUMN vault_dirty INTEGER NOT NULL DEFAULT 0;
```

- `vault_path` — path relative to the vault root; detects moves and renames
- `file_sha` — sha256 of the bytes we last wrote; drives echo suppression (§7)
- `vault_dirty` — survives a crash between the DB commit and the file write

## 6. Store changes

```rust
pub struct Store {
    conn: Connection,
    vault: Option<Vault>,     // None = legacy DB-only mode
    dirty: HashSet<String>,   // note ids awaiting flush
}
```

Of the 31 public store functions:

- **10 read functions are unchanged.** `list_notes`, `search_notes`,
  `list_tags`, `library_stats`, `workspaces_for_note` and peers keep the same
  SQL, the same FTS5 triggers, and the same `NoteFilter`. Nothing parses
  Markdown at query time.
- **13 note-writing functions gain one line each** — `self.dirty.insert(id)`.
  `create_note`, `update_note`, `soft_delete_note`, `restore_note`,
  `permanently_delete_note`, `set_notes_flags`, `soft_delete_notes`,
  `restore_notes`, `destroy_notes`, `add_tag_to_note`, `remove_tag_from_note`,
  `add_note_to_workspace`, `remove_note_from_workspace`.
- **8 tag/space/settings writers** update `instantnotes.yaml` or, for settings,
  nothing at all.

The `Store` is already documented as the single writer for all persistent state
(`store.rs:1`), which is what makes one choke point sufficient. No public
signature changes, so `store_test.rs` (1132 lines) keeps passing unmodified.

`flush_vault()` runs after each command returns:

```
for id in dirty:
    note  = fetch_note(id)
    path  = target_path(note)          # trash/ vs root; slug from title
    bytes = serialize(note)
    atomic_write(path, bytes)          # tmp in same dir, fsync, rename
    if note.vault_path != path:
        remove old file; rename sidecar
    UPDATE notes SET vault_path=?, file_sha=sha256(bytes), vault_dirty=0
```

Renaming a tag or a space rewrites the frontmatter of every note carrying it.
That is bounded and it is the price of names rather than opaque ids in the file.

## 7. Two writers

This is the only genuinely hard part of the change. Today SQLite is the sole
writer. Afterwards an external editor, a sync tool, or a git checkout can also
write, and the app must not fight its own writes: write file, watcher fires,
re-ingest, write again, forever.

Suppression is one comparison, no leases and no timers:

```
on_fs_event(path):
    bytes = read(path)
    if sha256(bytes) == file_sha of the row whose vault_path == path:
        return                      # our own write; drop it
    note = parse(bytes)
    upsert by frontmatter id        # new id => new note; known id => edit or move
    emit notes:changed
```

Other cases:

- **File deleted externally** → move the note to `trash/` state.
- **Unknown `id`, or no frontmatter** → new note; generate an `id` and write it
  back on next flush. This is how a note dropped into the folder by hand joins.
- **Known `id` at a new path** → a move; update `vault_path` only.
- **Debounce** filesystem events 150 ms; batch reconciliation in one transaction.

### 7.1 Editor buffer safety

If an external edit lands on the note currently open with unsaved changes, the
local buffer is never overwritten. The incoming version is written as a conflict
copy (§9) and the user keeps typing.

### 7.2 `last_opened_at` stays device-local

Writing it to frontmatter means *opening* a note dirties its file and triggers a
sync round-trip on every read. It also has per-device meaning — the Revisit view
is about what *this* device has seen. Keeping it in the cache leaves
`get_note(touch: true)` a pure cache write that never touches disk.

This is the one field deliberately not portable. If it must sync later, it moves
to a separate append-only file, not to note frontmatter.

## 8. Rebuild from disk

Triggered on cache loss, corruption, schema mismatch, or explicitly from
Settings.

```
seen = {}
for each *.md at vault root and under trash/:
    parse; upsert by id; seen += id
DELETE FROM notes WHERE id NOT IN seen
reconcile tags/spaces from instantnotes.yaml plus frontmatter
```

Upsert rather than truncate, so device-local `last_opened_at` survives a rebuild.
FTS5 repopulates through the existing triggers; no separate index pass.

Target: under 500 ms for 5,000 notes. Parsing is parallel; the insert is one
transaction.

## 9. Conflicts

No automatic body merge. Conflicts are made visible and non-destructive.

| Artifact | Resolution |
| --- | --- |
| `*.md` | Keep local. Write the remote side as `<Title> (conflict from <device> <date>).md` with a fresh `id`, so it appears as a normal note to reconcile by hand. |
| `*.excalidraw` | Element-level merge: match on element `id`, take `MAX(version, versionNonce)`, honor `isDeleted` tombstones. Deterministic, no user involvement. |
| `instantnotes.yaml` | Per-key last-write-wins. |
| `attachments/*` | Content-addressed filenames; cannot conflict. |

The Excalidraw merge is the one piece worth building, because no transport can
merge a JSON scene and a text-merged `.excalidraw` is a corrupt `.excalidraw`.

## 10. Transport: git

Built into `instantnotes-core` using `git2` (libgit2). `gix` is the pure-Rust
alternative if OpenSSL cross-compilation becomes a problem for iOS later.

- **Pull** on launch, on window focus, on `online`, and before every push.
- **Commit** 30 s after the last vault flush, on window blur, and on quit.
  Message: `notes: <title>` for one note, `notes: <n> changes` otherwise.
- **Push** after commit. On non-fast-forward: `pull --rebase`, then push. On
  rebase conflict: abort, apply §9, commit the resolution, push.
- **Auth**: HTTPS with a personal access token in the OS keychain (`keyring`
  crate). No SSH key management.
- **Remote**: any free private repo host. A text vault stays far inside free
  tier limits.

The vault gets a `.gitignore` for `.DS_Store` and editor droppings. The cache is
outside the vault, so nothing else needs ignoring — which is a direct benefit
of D4.

## 11. Transport: folder sync

Works with no additional code, because the vault is an ordinary directory. The
user points InstantNotes at a Syncthing, Nextcloud, or Dropbox folder. The
watcher in §7 already handles incoming writes; those tools generate their own
conflict files, which surface as ordinary notes.

This covers Linux ↔ macOS well. It does not cover iOS, which is why git is the
built-in transport rather than the optional one.

## 12. Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Two-writer echo loops or lost writes | §7 sha comparison; dual-write stage proves round-tripping before authority flips |
| R2 | Filename churn from auto-derived titles | Rename only at flush, only when the slug actually changes |
| R3 | Tag or space rename rewrites many files | Bounded and accepted; it is what keeps names in the files |
| R4 | Data loss during migration | Stage 1 is export-only. `backup_before_migration` (`store.rs`) already snapshots the DB before v5 runs |
| R5 | Vault on a WAL-hostile mount | Cache stays in app data (D4), so `store.rs:250` is never exercised against the vault |
| R6 | Private repo means the host can read notes | Out of scope. Recorded in §14 |

## 13. Rejected alternatives

Recorded so the reasoning is not relitigated. All of these appeared in the
superseded `docs/PORTABLE_VAULT_AND_SYNC_SPEC.md`.

- **Self-hosted Axum delta-sync server behind a Cloudflare Tunnel.** A second
  product — server, auth, protocol, deployment, operations — duplicating what
  git and Syncthing already do. A home server also has real ongoing cost in
  hardware, power, and maintenance, which contradicts the requirement.
- **Hybrid Logical Clocks.** Only needed to order events for a custom delta
  protocol. With no such protocol, the transport orders events.
- **diff3 automatic body merge.** Real complexity and a real corruption risk for
  a single-user app where conflicts are rare. Conflict copies are honest and
  cost nothing to build. Revisit if conflicts prove common in practice.
- **UUID filenames (`018f6c3a-….md`).** Defeats the requirement. A folder of
  UUIDs is not readable without the app.
- **`.instantnotes/cache.db` inside the vault.** See D4.
- **iCloud Drive as the primary transport.** No Linux client, and the iCloud
  container entitlement is unavailable under free Apple provisioning, so it is
  gated behind a paid developer account.
- **Syncthing as the only transport.** No free, reliable iOS client.
- **Dropping SQLite and parsing Markdown at query time.** Would make the sidebar,
  tag counts, and search scale with library size. The cache exists precisely so
  the format can be dumb.

## 14. Open questions

1. Should `last_opened_at` eventually sync? §7.2 says no for now; the Revisit
   view's intended semantics decide it.
2. Multiple vaults, or one per install? Assume one until there is a reason.
3. Encryption at the remote. A private repo is probably enough; `age` or
   `git-crypt` on the remote only would keep the local vault plaintext. Deferred.
4. Attachment garbage collection. Nothing currently removes an image when the
   last note referencing it is destroyed. Pre-existing, and the vault makes it
   visible; worth its own change.
