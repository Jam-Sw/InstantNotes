# API contract

The IPC surface between the Svelte webview and the Rust core. Every command
is registered in `src-tauri/src/lib.rs` and wrapped by a typed function in
`src/lib/api/client.ts`; the request and response types live in
`src/lib/api/types.ts`. Those files are the source of truth for exact
signatures. This document describes the shape of the boundary and enumerates
the stable error codes.

## 1. Overview

The core owns all business rules and persistence. UI code never invokes Tauri
commands directly: it calls the `client.ts` wrappers, which invoke the command
and translate failures into an `ApiError`. Data mutations happen only through
these commands; the frontend re-queries on `notes:changed`, `tags:changed`,
and `workspaces:changed` events rather than mutating local state optimistically.

## 2. Invocation

Each wrapper calls `invoke(name, args)` and returns a typed result. Arguments
are JSON objects; the one exception is `save_attachment`, which sends raw image
bytes as the request body with the file extension in an `x-attachment-ext`
header (see section 8).

## 3. Error handling

Commands return a `Result`. On failure the core produces an `AppError`, which
serializes to a plain object and is rethrown by the client as an `ApiError`
carrying the same `code`. `src/lib/errors.ts` maps each code to user-facing
copy; unknown codes fall back to a generic message.

### 3.6 Error object shape

A failed command rejects with:

```
{ code: string, message: string }
```

`code` is one of the stable identifiers in section 12. `message` is a
developer-facing description and is never shown to users verbatim.

## 4. Notes

| Command | Purpose |
| --- | --- |
| `create_note` | Create a note; title is derived from the body (see DATA_MODEL.md section 6). |
| `get_note` | Fetch one note by id. |
| `update_note` | Patch title/body/flags; an empty patch is a no-op. |
| `soft_delete_note` | Move a note to trash (`is_deleted = 1`). |
| `restore_note` | Restore a trashed note. |
| `permanently_delete_note` | Destroy a note and its rows for good. |
| `list_notes` | List notes for a status/space/tag filter. |
| `search_notes` | Full-text search over title and body (section 7 of DATA_MODEL.md). |

## 5. Tags

| Command | Purpose |
| --- | --- |
| `list_tags` | All tags with usage counts. |
| `get_or_create_tag` | Resolve a normalized tag name to a tag, creating it if new. |
| `update_tag` | Rename or recolor a tag. |
| `delete_tag` | Remove a tag and its note associations. |
| `add_tag_to_note` / `remove_tag_from_note` | Attach or detach a tag. |
| `tags_for_note` | Tags on one note. |

## 6. Workspaces

Workspaces are named note collections (many-to-many, like tags). The UI labels
them "Spaces"; the command and storage names keep `workspace`.

| Command | Purpose |
| --- | --- |
| `list_workspaces` | All workspaces with note counts. |
| `get_or_create_workspace` | Resolve a name to a workspace, creating it if new. |
| `rename_workspace` | Rename a workspace (duplicate names rejected as `CONFLICT`). |
| `delete_workspace` | Delete a workspace; member notes are untouched. |
| `list_workspace_tags` | Tags used by notes in one workspace. |
| `add_note_to_workspace` / `remove_note_from_workspace` | Manage membership. |
| `workspaces_for_note` | Workspaces a note belongs to. |

## 7. Settings

A simple key/value store for UI preferences. `get_setting`, `set_setting`,
`delete_setting`. Values are JSON-encoded; reads are best-effort and fall back
to defaults when a key is absent or malformed.

## 8. Attachments

| Command | Purpose |
| --- | --- |
| `save_attachment` | Store one pasted/dropped image; raw bytes in the body, extension in `x-attachment-ext`. Returns the generated filename. |
| `get_attachments_dir` | Absolute path of the attachments directory. |
| `import_image_file` | Copy an image picked through a file dialog into the attachments directory (the "copy in" storage mode). Takes an absolute `path`; returns the generated filename. |
| `allow_image_file` | Allow one existing local image file to load through the asset protocol (the "link the original file" storage mode). Takes an absolute `path` to a file that must already exist; widens the asset scope to that single file only, never a directory. Idempotent. |
| `open_attachments_folder` | Reveal the attachments folder in the OS file manager. |

Images live as files under `<app data>/attachments` and notes reference them by
relative `attachments/<name>` markdown paths. The webview reads them back over
the asset protocol, scoped to that directory in `tauri.conf.json`.

`import_image_file` and `save_attachment` both land copied images in the same
directory with the same `<uuid>.<ext>` naming; the former is for the toolbar's
"Insert image..." action (an existing file on disk), the latter for paste and
drop (bytes already in memory).

Link mode (`allow_image_file`) references the original file by its absolute
path instead of copying it, so the note body carries that path directly
(`![](/abs/path/to/file.png)`), not an `attachments/<name>` reference. Both
`import_image_file` and `allow_image_file` reject a path whose extension is
outside `png`, `jpg`, `jpeg`, `gif`, `webp` with a `VALIDATION` error naming the
rejected extension; `allow_image_file` additionally requires the file to exist.
Cancelling the file picker never calls either command — the frontend checks the
dialog result before invoking.

Link mode is a live-editing convenience only. It is not portable: a note that
uses it is not guaranteed to reproduce on a device without the original file at
that same path. The vault serializer (`export_vault`, §12) always materializes
a copy at export time regardless of storage mode; see
`feat-portable-vault-sync`'s `tasks.md` for the recorded decision.

## 9. Windows and shell

`hide_capture`, `open_library`, `set_window_vibrancy`, `set_window_theme`,
`export_theme_file`, `import_theme_file`, `export_note_file`, `open_url`,
`quit_app`. These drive native windows, theme file I/O, and external links; they
carry no note data beyond what the user explicitly exports.

## 10. Capture

`capture_input_ready` and `get_capture_latency` instrument the capture window's
reveal-to-ready latency, surfaced in the About panel as a product number.

## 11. Dashboard

`library_stats` returns every number on the Settings front page in one call. The
result is flat, but it is assembled from two places.

| Field | Meaning |
| --- | --- |
| `notesTotal` | Notes not in the Trash (active plus archived). |
| `notesActive` | Not trashed and not archived. |
| `notesPinned` | Not trashed and pinned. |
| `notesArchived` | Not trashed and archived. |
| `notesTrashed` | In the Trash. |
| `tags` | Rows in `tags`, including tags no live note uses. |
| `spaces` | Rows in `workspaces`. |
| `attachmentsCount` | Files directly inside `<app data>/attachments`. |
| `attachmentsBytes` | Their total size in bytes. |

The seven counts are one `COUNT(*)` each in `core/src/store/stats.rs`, returned
as the core's `LibraryStats`. The two attachment numbers are not in the store at
all: the desktop layer reads them off the filesystem and flattens them onto the
same object, so what crosses the boundary is `LibraryStats` plus two fields. The
frontend calls that flat shape `DashboardStats` in `types.ts`.

Attachment counting is best-effort on purpose. A missing or unreadable
attachments directory reports zero rather than failing the whole call, so the
rest of the dashboard still renders. Every regular file at the top level counts,
whether or not it is an image; subdirectories are neither traversed nor counted.

The numbers are a snapshot taken when the page is opened. Nothing pushes an
update, and the dashboard is not on any hot path.

## 12. Vault export

| Command | Purpose |
| --- | --- |
| `export_vault` | Write the whole library to `dest` (an absolute folder path) as a vault: one Markdown file per note plus `instantnotes.yaml`, per `feat-portable-vault-sync/design.md` §3. |

Stage 1 only (`feat-portable-vault-sync`, `SEQUENCE.md` unit 7): a one-way,
read-only snapshot. SQLite stays authoritative and nothing reads the folder
back yet. `dest` is chosen by a native folder-picker dialog in JS, the same
trust boundary as `export_note_file`.

Every note, active, archived, and trashed, is included. Active and archived
notes land at the vault root; trashed notes land under `dest/trash/`.
Filenames are the note's title (auto-derived when the user never set one
explicitly), sanitized for cross-platform filesystem safety, with the first
six characters of the note's id appended on a collision. Tag colors and the
full list of Spaces (including empty ones) go into `instantnotes.yaml`;
everything under `<app data>/attachments` is copied into `dest/attachments`.

Re-exporting to a folder that already holds a previous export does not remove
files for notes deleted or retitled since the last run; each call only writes
and overwrites, it never prunes. Acceptable for a one-way snapshot, recorded
in `feat-portable-vault-sync/tasks.md` for stage 2 (the dual-write flush) to
account for.

The store-to-vault gather (`instantnotes_core::vault::collect_from_store`)
pages through `list_notes` rather than trusting its default 500-row limit, so
a library larger than that is not silently truncated.

## 13. Feedback

| Command | Purpose |
| --- | --- |
| `submit_feedback` | Append one feedback submission to `<app data>/feedback.jsonl`. |
| `open_feedback_log` | Reveal `feedback.jsonl` in the OS file manager. |

`submit_feedback` takes a `FeedbackInput`:

| Field | Meaning |
| --- | --- |
| `category` | `"bug"`, `"idea"`, or `"other"`, from the Feedback page's kind selector. |
| `message` | The submission text. Rejected with `VALIDATION` when empty after trimming. |
| `appVersion` | Optional; the running app version. |
| `diagnostics` | Optional opt-in snapshot (`appVersion`, `platform`, `notes`, `attachments` counts), stored verbatim as shown to the user, or omitted when the user declined it. |

Each call appends one JSON line with a millisecond timestamp; nothing reads
the file back or prunes it. `submit_feedback` never touches the network — the
GitHub hand-off (a prefilled `issues/new` URL) runs entirely on the frontend
through `open_url` after the local write succeeds, so feedback is durable even
offline or when no browser opens. No note content (title, body, tags, Spaces)
is ever included; only what `FeedbackDiagnostics` (`src/lib/feedback.ts`)
names.

## 14. Error codes

| Code | Meaning |
| --- | --- |
| `NOT_FOUND` | The requested record does not exist. |
| `VALIDATION_ERROR` | Input failed a rule (empty name, bad type). |
| `CONFLICT` | A uniqueness constraint was violated (duplicate name). |
| `STORAGE_ERROR` | A persistence failure, including a corrupt database file. |
| `MIGRATION_ERROR` | The schema could not be upgraded. |

These are the only codes callers may branch on; they are asserted in
`src-tauri/core/src/error.rs`. Database corruption is reported as
`STORAGE_ERROR` externally, while the core keeps it distinct internally so it
can set aside a damaged file and start fresh.
