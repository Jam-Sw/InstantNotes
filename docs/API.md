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

`code` is one of the stable identifiers in section 11. `message` is a
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

Images live as files under `<app data>/attachments` and notes reference them by
relative `attachments/<name>` markdown paths. The webview reads them back over
the asset protocol, scoped to that directory in `tauri.conf.json`.

## 9. Windows and shell

`hide_capture`, `open_library`, `set_window_vibrancy`, `set_window_theme`,
`export_theme_file`, `import_theme_file`, `export_note_file`, `open_url`,
`quit_app`. These drive native windows, theme file I/O, and external links; they
carry no note data beyond what the user explicitly exports.

## 10. Capture

`capture_input_ready` and `get_capture_latency` instrument the capture window's
reveal-to-ready latency, surfaced in the About panel as a product number.

## 11. Error codes

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
