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
| `body` | Markdown body. For a whiteboard, the text on the board (section 3.1). |
| `created_at`, `updated_at`, `last_opened_at` | Lifecycle timestamps. |
| `is_pinned`, `is_archived`, `is_deleted`, `deleted_at` | Status flags. |
| `content_kind`, `surface_data` | `document` (default) or `whiteboard`, and a whiteboard's canvas (section 3.1). |
| `vault_path`, `file_sha`, `vault_dirty`, `board_sha` | The live vault mirror (section 10). |

Indexes cover `updated_at`, `created_at`, the status-flag triple, pending
vault writes, and `vault_path`.

### 3.1 Whiteboards

A note is a document or a whiteboard, and always a note: it lists, tags,
joins Spaces, trashes, and searches like any other. A whiteboard's canvas is
`surface_data`, an Excalidraw scene in a versioned envelope:

```json
{ "v": 1, "engine": "excalidraw", "data": { "elements": [], "appState": {}, "files": {} } }
```

Its `body` is the text written on the board, in reading order (top to bottom,
then left to right), rewritten with every save. Search, inline `#tags`, list
previews, and the vault's Markdown file therefore describe what the board
shows. Because the body moves with the drawing, converting freezes an auto
title (`title_is_auto = 0`).

`update_note` enforces the rest: converting is one-way (a whiteboard never
becomes a document again), and only a whiteboard holds `surface_data`. List
rows leave `surface_data` out, since a board can hold pasted images; opening
the note brings it.

## 4. Tags

`tags` (id, unique `name`, optional `color`, timestamps) and the join table
`note_tags` (`note_id`, `tag_id`, `created_at`, `source` = `manual` or the
inline-extraction source), keyed on the pair, cascading on note or tag delete.

## 5. Workspaces

`workspaces` (id, unique case-insensitive `name`, timestamps) and the join
table `note_workspaces` (`note_id`, `workspace_id`, `created_at`), keyed on the
pair, cascading on note or workspace delete. The UI calls these "Spaces".

## 6. Title derivation

`derive_title` takes the first line of the body with words on it (passing over
blank lines and lines that are only images), strips leading
markdown markers (`#`, `-`, `*`, `>`), the emphasis markers around each word
(`*`, `~`, `=`, and backticks, so `**Groceries**` titles the note
"Groceries"), and inline `#` tag prefixes, collapses whitespace, and truncates
to 80 characters on a char boundary. Markers inside a word stay (`C++`,
`a*b`). An empty body yields `Untitled`. A note keeps `title_is_auto = 1`
until the user edits the title directly.

## 7. Full-text search

`notes_fts` is an FTS5 external-content table over `title` and `body`
(`content='notes'`, `content_rowid='seq'`, `porter unicode61` tokenizer).
Triggers keep it in sync on insert, delete, and title/body update. Search
accepts plain user input without exposing FTS syntax errors.

## 8. Settings

`settings` is a `key`/`value`/`updated_at` table holding JSON-encoded UI
preferences. Reads are best-effort: a missing or malformed value falls back to
the code default.

`stickies` holds which notes are popped out as sticky windows on this device,
as a map from note id to `{ x, y, width, height, level, collapsed }` in
logical pixels (`x`/`y` null means centered; `level` is `float`, `normal`, or
`desktop`; while `collapsed`, `height` keeps the expanded height). It
is window state, not note data: it never reaches the vault, and losing it only
means stickies reopen in the library.

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
| v6 | `board_sha`, and triggers that carry whiteboards through the vault mirror (section 10). |

v4 exists because pre-release builds that carried the whiteboard already
migrated some libraries to it before the whiteboard was lifted off the 0.9.0
branch. A version number must mean one schema everywhere, so v4 ships as
those builds wrote it.

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
- `board_sha`: for a whiteboard, sha256 of its canvas file as last written.

A whiteboard's note file carries `kind: whiteboard` in its frontmatter, and
its canvas is a standard `.excalidraw` file beside it with the same name
(`Plan.md`, `Plan.excalidraw`), openable in Excalidraw. The canvas file
follows its note through renames, the trash, and deletes, under the same
ownership rules as the note file.

Triggers set `vault_dirty` in the same transaction as the write that changed
the note's file contents: the note's own columns (not `last_opened_at`,
which is device-local), its tag and Space edges (including the cascades from
deleting a tag or a Space), and a rename of a tag or Space it carries. A
permanent delete queues the file, and a whiteboard's canvas file, in
`vault_tombstones` (`vault_path`, `file_sha`). The flush writes pending notes, removes tombstoned files that
still hold the bytes it wrote, and clears the flags. A crash between the
commit and the file write leaves the flag set, and the next launch catches
up.
