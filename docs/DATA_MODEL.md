# Data model

The local storage schema and the pure rules that shape it. The schema is
defined by the ordered migrations in `src-tauri/core/src/store.rs`
(`MIGRATIONS`); the naming and title rules live in
`src-tauri/core/src/domain.rs`. SQLite with FTS5 backs everything; no data
leaves the machine.

## 1. Overview

Notes are the canonical user data. Tags and workspaces are lightweight
labels/collections attached many-to-many. Deleting a tag or workspace never
deletes notes. Timestamps are ISO-8601 strings.

## 2. Naming and normalization

### 2.1 Workspace names

Trim and collapse repeated whitespace, preserving case (workspaces are display
names). An empty result is rejected. Uniqueness is case-insensitive
(`COLLATE NOCASE`).

### 2.2 Tag names

`normalize_tag_name` produces the canonical form: trim, strip leading `#`,
lowercase, and collapse repeated whitespace. An empty result yields no tag.
Inline `#tag` tokens are extracted from body text when a `#` sits at the start
or after whitespace and is followed by alphanumeric / `-` / `_` characters;
extracted tags are normalized and deduped in order of first appearance.

## 3. Notes

`notes` table (primary key `seq`, a stable integer alias used as the FTS
content rowid; `id` is the public UUID):

| Column | Notes |
| --- | --- |
| `seq` | Integer primary key; FTS `content_rowid`. |
| `id` | Public UUID, unique. |
| `title`, `title_is_auto` | Title and whether it was auto-derived (section 6). |
| `body` | Markdown body. |
| `created_at`, `updated_at`, `last_opened_at` | Lifecycle timestamps. |
| `is_pinned`, `is_archived`, `is_deleted`, `deleted_at` | Status flags. |
| `content_kind`, `surface_data` | Surface mode (`document` by default) and whiteboard data. Added by v4 and not read yet; see section 9. |
| `vault_path`, `file_sha`, `vault_dirty` | The live vault mirror (section 10). |

Indexes cover `updated_at`, `created_at`, the status-flag triple, pending
vault writes, and `vault_path`.

## 4. Tags

`tags` (id, unique `name`, optional `color`, timestamps) and the join table
`note_tags` (`note_id`, `tag_id`, `created_at`, `source` = `manual` or the
inline-extraction source), keyed on the pair, cascading on note or tag delete.

## 5. Workspaces

`workspaces` (id, unique case-insensitive `name`, timestamps) and the join
table `note_workspaces` (`note_id`, `workspace_id`, `created_at`), keyed on the
pair, cascading on note or workspace delete. The UI calls these "Spaces".

## 6. Title derivation

`derive_title` takes the first non-empty line of the body, strips leading
markdown markers (`#`, `-`, `*`, `>`) and inline `#` tag prefixes, collapses
whitespace, and truncates to 80 characters on a char boundary. An empty body
yields `Untitled`. A note keeps `title_is_auto = 1` until the user edits the
title directly.

## 7. Full-text search

`notes_fts` is an FTS5 external-content table over `title` and `body`
(`content='notes'`, `content_rowid='seq'`, `porter unicode61` tokenizer).
Triggers keep it in sync on insert, delete, and title/body update. Search
accepts plain user input without exposing FTS syntax errors.

## 8. Settings

`settings` is a `key`/`value`/`updated_at` table holding JSON-encoded UI
preferences. Reads are best-effort: a missing or malformed value falls back to
the code default.

## 9. Migrations

`MIGRATIONS` is an ordered list of SQL scripts; `user_version` records how many
have run, so a database upgrades forward exactly once per version. The list is
public so tests can build fixtures at a historical schema version.

| Version | Change |
| --- | --- |
| v1 | Notes, tags, settings, FTS. |
| v2 | Workspaces (Spaces). |
| v3 | Drop the unused sync scaffolding columns. |
| v4 | `content_kind`, `surface_data`: the whiteboard's surface mode. |
| v5 | The vault mirror: columns, `vault_tombstones`, and triggers (section 10). |

v4 exists because pre-release builds that carried the whiteboard already
migrated some libraries to it before the whiteboard was lifted off the 0.9.0
branch. A version number must mean one schema everywhere, so v4 ships as
those builds wrote it, and nothing reads its columns until the whiteboard
returns.

Before migrating an existing library, `Store::open` snapshots it next to
itself as `<file>.backup-v<old version>`. A library at a version newer than
the build knows is refused, never migrated.

## 10. Vault mirror

When a vault folder is set (the device-local setting `vault.path`), every
note is also written there as Markdown
(`openspec/changes/feat-portable-vault-sync/design.md`). SQLite stays
authoritative: the folder is written, never read back.

- `vault_path`: where the note's file was last written, relative to the
  vault folder (`trash/` for deleted notes).
- `file_sha`: sha256 of the bytes last written there.
- `vault_dirty`: 1 while the file is behind the database.

Triggers set `vault_dirty` in the same transaction as the write that changed
the note's file contents: the note's own columns (not `last_opened_at`,
which is device-local), its tag and Space edges (including the cascades from
deleting a tag or a Space), and a rename of a tag or Space it carries. A
permanent delete queues the file in `vault_tombstones` (`vault_path`,
`file_sha`). The flush writes pending notes, removes tombstoned files that
still hold the bytes it wrote, and clears the flags. A crash between the
commit and the file write leaves the flag set, and the next launch catches
up.
