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

Neither side writes an event name or an error code as a literal. Both live in
one registry per language — `src-tauri/src/events.rs` and
`src-tauri/src/error.rs` on the Rust side, `src/lib/api/events.ts` and
`src/lib/api/error-codes.ts` on the frontend — and `src/lib/api/contract.test.ts`
holds the registries, this document, and the core's `AppError::code()` equal,
since no type can cross the IPC boundary.

## 2. Invocation

Each wrapper calls `invoke(name, args)` and returns a typed result. Arguments
are JSON objects; the one exception is `save_attachment`, which sends raw image
bytes as the request body with the file extension in an `x-attachment-ext`
header (see section 8).

## 3. Error handling

Commands return a `Result`. On failure the core produces an `AppError`, which
serializes to a plain object and is rethrown by the client as an `ApiError`
carrying the same `code`, typed as `ErrorCode`. `src/lib/errors.ts` maps each
code to user-facing copy, exhaustively, so a new code does not compile until it
has copy. A code the frontend does not know can only come from a mismatched
backend; `client.ts` reports it as `STORAGE_ERROR` and keeps the original code
in the developer-facing message.

### 3.6 Error object shape

A failed command rejects with:

```
{ code: string, message: string }
```

`code` is one of the stable identifiers in section 14. `message` is a
developer-facing description and is never shown to users verbatim.

## 4. Notes

| Command | Purpose |
| --- | --- |
| `create_note` | Create a note; title is derived from the body (see DATA_MODEL.md section 6). |
| `get_note` | Fetch one note by id, including a whiteboard's `surfaceData`. |
| `update_note` | Patch title/body/flags, `contentKind`, and `surfaceData`; an empty patch is a no-op. The reply omits `surfaceData`: the caller already holds the canvas it saved. |
| `soft_delete_note` | Move a note to trash (`is_deleted = 1`). |
| `restore_note` | Restore a trashed note. |
| `permanently_delete_note` | Destroy a note and its rows for good. |
| `set_notes_flags` / `soft_delete_notes` / `restore_notes` / `destroy_notes` | The same for a multi-selection (`ids`), each in one transaction. `set_notes_flags` takes optional `isPinned` and `isArchived`; `destroy_notes` refuses without `confirm: true`. |
| `list_notes` | List notes for a status/space/tag filter. Rows carry `contentKind` but not `surfaceData`. |
| `search_notes` | Full-text search over title and body (section 7 of DATA_MODEL.md). |
| `library_graph` | Live notes, every tag and Space, and one link per note-to-tag or note-to-Space membership, for the Graph view. A tag link carries its `source` (`inline`, written in the text, or `manual`, added to the note); a Space link's is null. Derived on every call; nothing about the graph is stored. Trashed and archived notes are left out. |
| `space_suggestions` | Where each live note in no Space most likely belongs (section 4.1): `noteId`, `noteTitle`, `spaceId`, `spaceName`, `probability` (0 to 1), and up to three `reasons` (`label`, `kind` = `tag` or `word`), newest note first. Empty until two Spaces hold notes. |
| `dismiss_space_suggestion` / `restore_space_suggestion` | "Not this one" for a (`noteId`, `spaceId`) pair, and its undo. Device-local (DATA_MODEL.md section 8); an unknown note or Space is `NOT_FOUND` on dismiss. Neither emits a library event: nothing about a note changed. |

`contentKind` is `document` or `whiteboard`. `update_note` rejects turning a
whiteboard back into a document and `surfaceData` on a document, both with
`VALIDATION_ERROR`. A whiteboard's `body` is the text on its board, written
by the app with each canvas save (DATA_MODEL.md section 3.1).

`update_note` takes an optional `expectedUpdatedAt`. When given, the patch
applies only if the note's `updatedAt` still equals it, checked inside the
write transaction; otherwise it fails with `CONFLICT` and changes nothing. The
editor's document saves send the version they were based on, so a write from
another process in between (an agent, section 15) is noticed, not overwritten.

### 4.1 Filing suggestions

The Graph says where the unfiled notes belong. The model is the library
itself, recounted on every call (core `classify.rs`, `store/suggest.rs`):
a Dirichlet-Multinomial naive Bayes over each note's tags and content words
(DATA_MODEL.md section 2.3), with the Spaces that hold notes as the classes.
A tag written inline in the text weighs twice one added to the note
afterwards: writing `#pasta` says what a thought is about, filing says how it
was sorted later. Each Space's likelihoods are smoothed with 0.5
pseudo-counts per feature, so two notes make a Space; a note's evidence is
averaged past twelve informative features, so a long note is not certain for
being long; and a Space is suggested only when the posterior is at least 0.5
and the evidence itself, not the Space's size through the prior, favours it.
The reasons are the features with the highest weight of evidence for the
Space against the rest. The numbers behind each of those choices are in
`openspec/changes/feat-graph-suggestions/proposal.md` and reproduced by
`core/tests/suggest_bench_test.rs`.

Nothing is trained and nothing is stored: filing a note, from the graph, the
editor, or an agent (section 15), is a membership, and the next read counts
it. Trashed and archived notes neither teach nor get suggestions. A
suggestion is for a note in no Space; a note already in one is never
re-sorted. The policy is suggest-only: no call files a note on the model's
word, and the frontend's one-tap accept is `add_note_to_workspace`.

## 5. Tags

| Command | Purpose |
| --- | --- |
| `list_tags` | All tags with usage counts. |
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
| `unused_attachments` | `{ count, bytes }` of stored images no note references, older than an hour. |
| `remove_unused_attachments` | Remove those images, and their unchanged copies in the live vault's `attachments/`. Returns what it removed as `{ count, bytes }`. |

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

Cleanup. `permanently_delete_note` and `destroy_notes` also remove the copied
images only the destroyed notes referenced. An image stays while anything
references it as `attachments/<name>`: any note in any state (the Trash and the
Archive included), a whiteboard's canvas, or the capture draft. The match
ignores case. The store stays locked from the reference check to the removal,
so no save can start using an image mid-cleanup, and a cleanup failure never
fails the delete. The unused-images commands cover what older versions left
behind; they skip images added in the last hour, since a fresh paste can
belong to an edit that has not saved yet. Linked originals are never touched.

Link mode is a live-editing convenience only. It is not portable: a note that
uses it is not guaranteed to reproduce on a device without the original file at
that same path. The vault serializer (`export_vault`, §12) always materializes
a copy at export time regardless of storage mode; see
`feat-portable-vault-sync`'s `tasks.md` for the recorded decision.

## 9. Windows and shell

`hide_capture`, `open_library`, `set_window_vibrancy`, `set_window_theme`,
`export_theme_file`, `import_theme_file`, `export_note_file`, `open_url`,
`quit_app`. These drive native windows, theme file I/O, and external links; they
carry no note data beyond what the user explicitly exports. `export_note_file`
writes `.md`, `.txt`, or `.excalidraw` (a whiteboard's canvas).
`get_shortcut_failure` returns why the global capture shortcut could not be
registered at launch, or `null`; the welcome screen shows it.

The File menu announces itself to the library window with `menu:new-note`,
`menu:new-whiteboard`, `menu:export-note`, and `menu:toggle-sticky` (no
payload). Every event name the
shell emits is declared in `src-tauri/src/events.rs`.

### 9.1 Stickies

A sticky is a note popped out of the library into its own window
(`sticky-<noteId>`, route `/sticky`). While it is open it is the note's only
editor; the library shows a placeholder and refuses body, title, and canvas
edits for that note, so the store never has two writers on one note.

| Command | Purpose |
| --- | --- |
| `pop_out_note(id)` | Open the note as a sticky, or bring its window forward. Rejects a note in the Trash. The library writes the note's pending edit first. |
| `pop_in_note(id)` | Emit `sticky:close-requested` to that window, wait for `answer_pop_in`, then close it. Resolves once the edits are on disk; rejects, leaving the sticky open, when the sticky reports its save failed. A sticky that does not answer within 1.5s is closed anyway. |
| `answer_pop_in(saved)` | The sticky's answer to `sticky:close-requested`. |
| `list_stickies()` | Ids of the notes that are stickies. |
| `get_sticky_view()` | The calling sticky's `{ level, collapsed }`, for its header on load. |
| `set_sticky_level(level)` | The calling sticky's level: `float` (above every window, on every Space), `normal`, or `desktop` (below every window, on every Space). |
| `set_sticky_collapsed(collapsed)` | Roll the calling sticky up to its 30px header, or back down to its saved height. |
| `save_sticky_geometry()` | Remember the calling sticky's position and size, read from the window itself. |

A sticky's header is its title bar: pressing and dragging it moves the window
(the `stickies` capability grants `core:window:allow-start-dragging` to
`sticky-*` windows only), and double-clicking it collapses or expands the
note, as Apple's Stickies does. The window accepts the first click, so an
unfocused sticky moves in one gesture.

The level and geometry commands act on the window that calls them, never on an
id the webview names. `stickies:changed` (no payload) fires whenever a note
becomes a sticky or stops being one. Stickies reopen at launch; one whose note
is gone or in the Trash is dropped, and one saved on a display that is no longer
attached is centered.

Quitting waits for every window that holds edits: the library and each sticky
flush on `app:quit-requested` and answer with `quit_app`, and the app exits on
the last answer (or after the 800ms fallback).

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

## 12. Vault

| Command | Purpose |
| --- | --- |
| `export_vault` | Write the whole library to `dest` (an absolute folder path) as a vault: one Markdown file per note plus `instantnotes.yaml`, per `feat-portable-vault-sync/design.md` §3. |
| `get_vault_status` | The live mirror's state: `{ path, pending, lastError, lastFlushedAt }`. `path` is null when mirroring is off. |
| `set_vault_folder` | Start mirroring into `path` (an absolute folder), move the mirror to a new folder, or stop it with `path: null`. Returns the new status. |
| `verify_vault` | Flush anything pending, then compare every file with the library: `{ checked, missing, diverged, orphans, pending, manifestOk }`. Read-only. |

| Event | Payload | Meaning |
| --- | --- | --- |
| `vault:status` | none | A mirror flush finished; re-read `get_vault_status`. |

SQLite stays authoritative for both the export and the mirror; nothing reads a
vault folder back yet. Folders are chosen by a native folder-picker dialog in
JS, the same trust boundary as `export_note_file`.

### 12.1 Export (stage 1)

Every note, active, archived, and trashed, is included. Active and archived
notes land at the vault root; trashed notes land under `dest/trash/`.
Filenames are the note's title (auto-derived when the user never set one
explicitly), sanitized for cross-platform filesystem safety. Names collide
case-insensitively, since macOS and Windows filesystems are: on a collision
the first six characters of the note's id are appended, or the whole id if
even that is taken. Tag colors and the full list of Spaces (including empty
ones) go into `instantnotes.yaml`; everything under `<app data>/attachments`
is copied into `dest/attachments`.

Re-exporting to a folder that already holds a previous export does not remove
files for notes deleted or retitled since the last run; each call only writes
and overwrites, it never prunes. An export into the live mirror's folder (or
inside it) is refused with `STORAGE_ERROR`: the mirror already keeps it
current.

The store-to-vault gather (`instantnotes_core::vault::collect_from_store`)
pages through `list_notes` rather than trusting its default 500-row limit, so
a library larger than that is not silently truncated.

### 12.2 Live mirror (stage 2)

`set_vault_folder` validates the folder (absolute, existing, and not inside or
around the app data folder, which holds the database) and returns at once.
Setting a new folder marks every note pending; a background writer then
flushes them, 50 notes per hold of the store lock, and emits `vault:status`
after each flush. From then on every note, tag, and Space write marks the
affected notes pending (in the database, by trigger) and pokes the writer,
which flushes once writes pause for 300 ms (at most 2 s later). Quitting
flushes one more chunk; anything left is flushed at the next launch.

Filenames follow §12.1. A note moves when its title or trash state changes; a
permanent delete removes its file. The mirror only writes or removes files it
owns: a path it recorded, or a file whose frontmatter `id` is the note's. A
file with a different or missing `id` at a note's name is left alone, and the
note takes a suffixed name. A file edited outside the app is replaced the next
time its note changes, but is never removed by a move or delete. Attachments
missing from `<vault>/attachments` are copied in on setup, at launch, and
after each image is saved; existing names are never overwritten.

A missing folder (an unmounted drive) pauses the mirror: `lastError` reads
`vault folder not found: <path>`, notes stay pending, the folder is never
recreated, and the next flush after it returns catches up. Stopping the
mirror leaves the written files in place.

In `verify_vault`, `missing` are notes whose file is gone, `diverged` are
files whose contents no longer parse to their note, and `orphans` are `.md`
files at the vault root or in `trash/` that the mirror did not write. Pending
notes are counted, not compared. With no folder set it fails with
`VALIDATION_ERROR`; with the folder missing, `STORAGE_ERROR`.

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
| `CONFLICT` | A uniqueness constraint was violated (duplicate name), or a note changed since the version an `update_note` named. |
| `STORAGE_ERROR` | A persistence failure, including a corrupt database file. |
| `MIGRATION_ERROR` | The schema could not be upgraded. |

These are the only codes callers may branch on, and the only values
`ErrorCode` has on either side. The core's `AppError::code()`
(`src-tauri/core/src/error.rs`) is the authority for the strings; the shell
builds every error through `CmdError::storage`/`::validation` or
`From<AppError>`, so no call site can name a code itself, and this table is
asserted against both registries by `src/lib/api/contract.test.ts`. Database corruption is reported as
`STORAGE_ERROR` externally, while the core keeps it distinct internally so it
can set aside a damaged file and start fresh.

## 15. Agents

Agents reach the library through the Model Context Protocol, served by the
app's own binary in a second mode (`src-tauri/agents`, crate
`instantnotes-agents`):

```
instantnotes mcp --db <library.db> [--attachments <dir>]
```

`main()` checks for `mcp` before Tauri starts, so this process never opens a
window or meets the single-instance plugin. It opens the library with
`Store::open` (never `open_or_recover`), speaks newline-delimited JSON-RPC 2.0
on stdio, and writes nothing but protocol to stdout and no note content to
stderr. It works whether or not the app is running.

It serves both eras of the specification. A request whose `_meta` names
`2026-07-28` is served statelessly: `server/discover` describes the server,
every result carries `resultType: "complete"` and the server's identity, and
an unknown version is refused with `-32022` and the supported list. Anything
else follows the `initialize` handshake of 2025-11-25 back to 2024-11-05,
including a JSON-RPC batch on one line. An unknown tool, or `arguments` that
are not an object, is a JSON-RPC error (`-32602`); everything a tool refuses
is a result with `isError`, which the model sees. Successful results carry
their JSON as `structuredContent` and again as text. A request that panics
inside the server is answered with `-32603` and the connection goes on. Every
response is checked against the official MCP JSON Schema of its revision.

Besides tools, the server declares `resources`: `resources/list` offers the
fifty most recently updated live notes as `instantnotes://notes/<id>`
(`text/markdown`), `resources/templates/list` names that template, and
`resources/read` returns one note's Markdown, or `-32002` for an id that is
not a note. Resources sit behind the same read gate as the read tools.

| Tool | Access | Store call |
| --- | --- | --- |
| `search_notes`, `list_notes`, `get_note`, `get_notes`, `list_tags`, `list_spaces` | read | `search_notes_page`, `list_notes` and `count_notes`, `get_note(id, false)`, `list_tags`, `list_workspaces` |
| `suggest_space` | read | `space_suggestions` (section 4.1), for one note (`id`) or every unfiled note (`limit`, default 50): each with its Space, a probability, and the reasons. The same model the user sees in the Graph; it files nothing, and says so, so an agent that agrees calls `add_to_space`. |
| `create_note`, `update_note`, `append_to_note` | write | `create_note`, `update_note` with `expectedUpdatedAt` |
| `tag_note`, `untag_note`, `add_to_space`, `remove_from_space` | write | the tag and workspace membership calls |
| `trash_note`, `restore_note` | write | `soft_delete_note`, `restore_note` |

Every tool declares a `title`, an input schema that rejects unknown
properties, and annotations: `readOnlyHint` for reads, `destructiveHint` for
the writes that remove or replace (`update_note`, `untag_note`,
`remove_from_space`, `trash_note`), `idempotentHint`, and `openWorldHint:
false`, since a tool only ever touches this library.

An agent is meant to search, then read only what matters. `search_notes`
takes `query`, `match` (`all` or `any` of the words), `space`, `tag`, `status`
(`active`, `archived`, `all`; never the Trash), `updatedAfter` and
`updatedBefore` (a date or a UTC timestamp), `limit`, and `offset`. Each
result carries `passages`: up to three, each the matching line with the
line before and after it and its 1-based `line`, plus `matchingLines`, the
count of lines that match in all. `get_notes` reads up to 50 notes in full
in one call, in the order asked, and returns ids that name no note in
`missing`. `search_notes` and `list_notes` are paged: `total` is how many
match in all, `hasMore` whether to ask again, and `nextOffset` from where.
`list_notes` takes the same two dates.

`list_notes` with `status: "revisit"` is the Revisit view's filter. Reads never
set `lastOpenedAt`. There is no permanent delete, no settings, no vault, and
no whiteboard canvas at any access level; writing a whiteboard's text is
refused.

Two settings keys belong to this surface:

| Key | Written by | Meaning |
| --- | --- | --- |
| `agents.access` | Settings > Agents | `"off"` (default), `"read"`, or `"write"`; re-read on every call. |
| `agents.notify` | Settings > Agents | Which calls raise a toast: `"writes"` (default), `"all"`, or `"off"`. |

Every call that passes the access gate is traced in the `agent_activity`
table (DATA_MODEL.md section 11), failures included; a refused call leaves
nothing. A row carries `seq`, `at` (epoch ms), `session` (one per server
process), `client` (the client's name, from the handshake or the request),
`tool`, `kind` (`read`, `search`, `write`), `status` (`ok`, `error`) and
`error`, `durationMs`, `noteIds` (up to 50), `noteCount`, `titles` (first
three), `space`, `tag`, `query`, `afterUpdatedAt`, `revertable`,
`revertedAt`, and `reverts`. A successful write also stores the note as it
was just before (fields, tags with their sources, Spaces), which is what
makes it revertable; a create stores "no note", and reverting it trashes the
note.

| Command | Purpose |
| --- | --- |
| `agent_connection` | The running executable, the live library path, and the attachments dir, for the connect commands on Settings > Agents. |
| `list_agent_activity` | The trace, newest first (`limit`, `offset`). |
| `agent_activity_before` | The snapshot a write row holds, or `null` for a create. |
| `list_agent_sessions` | Every known agent connection, newest first: `session`, `client`, `connectedAt`, `disconnectedAt`, `label`, `clientSession`, `cwd`, `matched` (`exact` or `inferred`), and `connected` (the process holds its lock right now). The same list arrives as the `agents:sessions` event whenever it changes. |
| `agent_activity_wire` | The raw exchange a row holds: `request` and `response`, each the whole JSON-RPC message as JSON text, or `null` where none was kept. |
| `revert_agent_activity` | Put the note back as the row's snapshot has it (or trash a created note), mark the row reverted, and record the revert as a row of its own (client `instantnotes`, tool `revert`) with the state it replaced, so it can be reverted in turn. Returns that row; `CONFLICT` for a row already reverted. |
| `clear_agent_activity` | Forget the trace. Notes are untouched. |

The app notices another process's commits through SQLite's `data_version`,
read every 400 ms by `shell/agents.rs`. When it moves, the rows newer than
the last `seq` announced go to the webview as `library:external-change`
(oldest first); if any was a successful write, or none describes the change,
the three change events fire and the vault mirror flushes, as after the app's
own writes. A revert made in the app is emitted the same way. Write
transactions begin `IMMEDIATE` so two processes queue on the busy timeout
instead of failing on a lock upgrade.

## 16. Import

Settings > Import, shown on macOS. Its one source is Apple Stickies
(`openspec/changes/feat-stickies-import/design.md`).

| Command | Purpose |
| --- | --- |
| `stickies_location` | Where Stickies keeps its notes, for the folder picker to open at; `null` off macOS. |
| `scan_stickies` | Read the folder the user picked, or the Stickies folder inside it, and preview each sticky: `id`, `title` (the one the note will get), `text` (the start of its Markdown), `color` (`#rrggbb` or `null`), `createdAt`, `updatedAt`, `images`, and `imported`. When macOS refuses access this is `readable: false`, not an error. |
| `import_stickies` | Import the stickies `ids` from `folder` in one transaction, filed in the Space named `space` (none when blank or `null`). Returns `{ imported, skipped, workspaceId }`; `skipped` counts stickies imported before. |

The folder comes from the webview, chosen with the native picker, which is
also what gives the app access to another app's data on macOS. These commands
only read it: `*.rtfd` packages (a flat `.rtfd` file, which is a sticky not
saved yet, or a symlink is skipped), `TXT.rtf` up to 16 MiB, the
`.SavedStickiesState` colors, and the images a sticky names. An image must be
a plain file name inside its own package, a regular file, at most 50 MiB, and
an image by its first bytes. PNG, JPEG, GIF, and WebP are copied into the
attachments folder as they are, anything else becomes PNG through `sips` on
macOS, and otherwise the note says `[Not imported: <name>]` where the image
was. Nothing is ever written under the chosen folder.

Each note keeps the sticky's dates, gets its title from its first line and
tags from its `#words` as any note does, and is stamped as opened, so an
import does not fill Revisit. The settings key `import.stickies` maps each
imported sticky's UUID to its note, written in the same transaction. A sticky
whose note still exists, in the Trash or not, is not imported again; one whose
note was destroyed for good is.
