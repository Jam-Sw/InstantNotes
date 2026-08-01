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
| `body` | Markdown body (always human-readable; FTS indexes this). |
| `content_kind` | `document` (default) or `whiteboard`. Surface mode for the open note. |
| `surface_data` | Optional JSON for whiteboard engines; null for plain documents. |
| `created_at`, `updated_at`, `last_opened_at` | Lifecycle timestamps. |
| `is_pinned`, `is_archived`, `is_deleted`, `deleted_at` | Status flags. |

Indexes cover `updated_at`, `created_at`, and the status-flag triple.

### 3.1 Surface mode (document vs whiteboard)

A note is always a note. `content_kind` chooses how the library opens it:

- `document` — markdown editor (CodeMirror), as before.
- `whiteboard` — canvas host; engine payload lives in `surface_data`, not `body`.

Converting a document to a whiteboard is a **one-way product action**. The UI
always confirms (danger tone) and never offers convert-back: users should not
accidentally replace a text note with a board. Capture always creates documents.
There is no separate whiteboard entity and no new sidebar section.

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
