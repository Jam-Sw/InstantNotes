# Design: Sheet Notes

## 1. Stored shape

`surfaceData` holds a versioned envelope, like a whiteboard's:

```json
{
  "v": 1,
  "engine": "grid",
  "data": {
    "cols": [{ "w": 120 }, { "w": 120 }, { "w": 240 }],
    "rows": [["Date", "Build", "ms"], ["2026-10-03", "a1f3", "412"]]
  }
}
```

- `rows` is a dense array of arrays of strings: each cell's **raw input**,
  exactly as typed. Empty cells are `""`. Every row has `cols.length` cells.
- `cols` carries only per-column view state (width in CSS px). Column names
  are spreadsheet letters (A, B, C ...) drawn by the view, not stored.
- A new sheet is 3 columns by 20 rows, all empty.
- Limits that keep it a companion, not a database: 52 columns (A to AZ),
  5,000 rows, 10,000 characters per cell. Past the row cap, Enter stops
  appending and a toast says why (the editor's status bar shows save state,
  not messages). All three are enforced in `update_note`'s validation, so no
  writer, MCP included, can exceed them, and the worst-case envelope is
  bounded.

Strings only, deliberately. Typed values (number, date) are what a formula
engine produces; storing them now would mean deciding the engine's type system
before the engine exists.

## 2. Model, view, and the seam for formulas

```
src-tauri/core/src/
  sheet.rs       parse and validate the envelope; Sheet -> GFM table (the
                 body); Sheet -> CSV (vault sidecar, export); append_rows
src/lib/sheet/
  model.ts       Sheet type, pure edit operations (setCell, insertRow,
                 deleteRows, insertCol, deleteCols, resizeCol, pasteBlock),
                 each returning a new Sheet plus its inverse for undo
  selection.ts   active cell, anchor, range; pure movement functions
  keys.ts        keydown -> intent, pure and table-tested
  tsv.ts         range <-> TSV for the clipboard
src/lib/components/sheet/
  SheetGrid.svelte   the DOM grid; owns focus, renders, dispatches intents
```

The serializers are in Rust, once, because two writers produce a sheet's
body: the grid and `append_sheet_rows`. A TS copy would have to match the
Rust one byte for byte or every agent append would rewrite the vault file
with a differently spaced table. So `update_note` derives a sheet's `body`
from its `surfaceData` on every save, and the frontend never sends a sheet's
body (§4). The TSV clipboard format is the one serializer that only the view
needs, and it stays in TS.

The view never formats a cell itself. It calls one function:

```ts
display(sheet: Sheet, row: number, col: number): string
```

In this change, `display` returns the raw input. A formula engine later
replaces that one function's body with "evaluate if it starts with `=`",
reading the same `Sheet`. Nothing else in the view changes, and nothing
ships now that only the future engine calls. That is the whole seam: one
function, used today, not an engine registry. (The whiteboard unit removed a
dead engine abstraction for this reason; see SEQUENCE.md §12.)

Everything in `src/lib/sheet/` is plain TypeScript with no Svelte or DOM, so
it is unit tested directly and a headless engine (in TS, or in Rust over the
same JSON) can read the model as is.

## 3. Interaction

Two modes, as in Sheets and Excel.

**Select mode** (a cell is highlighted, no caret):

| Key | Does |
| --- | --- |
| Arrows | Move one cell |
| Shift+Arrows | Extend the range |
| Cmd/Ctrl+Arrows | Jump to the edge of the data |
| Tab / Shift+Tab | Move right / left; wrap to the next / previous row |
| Enter | Start editing (Sheets behavior) |
| F2 | Start editing with the caret at the end |
| Any printable key | Start editing, replacing the cell with that key |
| Delete / Backspace | Clear the selected cells |
| Cmd/Ctrl+C, X, V | Copy, cut, paste the range as TSV, so ranges move to and from Sheets, Excel, and Numbers |
| Cmd/Ctrl+Z, Shift+Z | Undo, redo within the grid |
| Cmd/Ctrl+A | Select all cells |
| Esc | Leave the grid, returning focus to the note list (Esc's existing role in the app) |

**Edit mode** (caret inside one cell):

| Key | Does |
| --- | --- |
| Enter | Commit; move down to the column where the current Tab run started. On the last row, append a row first |
| Shift+Enter | Commit; move up |
| Tab / Shift+Tab | Commit; move right / left |
| Esc | Cancel the edit, restore the cell |
| Arrows | Move the caret in the text (no cell movement) |
| Alt/Option+Enter | Newline inside the cell |

Mouse: click selects, drag selects a range, double-click edits, drag a column
edge to resize. Right-click on a row or column header offers Insert above or
below, Insert left or right, and Delete, through the app's existing context
menu, not a custom one.

**Focus contract.** The grid handles keydown only while focus is inside it.
It calls `preventDefault` and `stopPropagation` only for the keys in the two
tables above. Any key with Cmd/Ctrl that is not in those tables (palette, new
note, pop-out, settings, quit) passes through untouched, and so does every key
when the grid is not focused. A test asserts this against the command
registry and against the window handler's own global keys (⌘K, ⌘⇧A, ⌘\,
⌘=, ⌘-, ⌘0), so a future app shortcut that collides fails CI instead of
silently losing to the grid.

The library window's handler (`+page.svelte`) treats the grid as a typing
target, like an `<input>`, not as a board target. A board target makes the
handler stand aside for every key because Excalidraw owns arrows and ⌘A; the
grid owns only the keys above, so it takes the typing-target path, where the
handler's list keys (arrows, ⌘A, ⌘Backspace, Escape) already stand aside and
its global keys already run. `isTypingTarget` gains `[data-sheet]`.

**Rendering.** One `<table>` of `<td>` elements; the cell being edited holds a
single `<input>` (a `<textarea>` once it contains a newline). Only one input
exists at a time, so the DOM stays light. Rows outside the scroll viewport
are not rendered once a sheet passes 200 rows (fixed row height, spacer rows
above and below). All colors, borders, and fonts come from the theme's CSS
variables, so light, dark, and custom themes apply with no sheet-specific
theme code.

## 4. Saving

A grid edit produces a new `Sheet`; `SheetGrid` hands `{ surfaceData }` to
the note's `SaveQueue` as `WhiteboardCanvas` hands its canvas. The store
derives `body` (`sheet.rs`) inside `update_note` and returns the note with
it, so the list preview and search update from the saved note, not from an
optimistic copy. A body sent with a sheet's `surfaceData` is ignored. Undo
history lives in the component and is not persisted.

`body` is a GFM table using row 1 as the header row, trailing empty rows and
columns trimmed, pipes and newlines in cells escaped (`\|`, `<br>`). An
all-empty sheet has an empty body. As with whiteboards, a sheet's title is
frozen on creation (`title_is_auto = 0`, default "Untitled sheet") since the
body moves with every cell.

"New sheet" creates a note and patches it to `sheet`, the two steps
`newWhiteboard` takes; the store allows `document` -> `sheet` one way and
nothing out of `sheet`. The conversion is not offered in the UI for an
existing document (no Markdown-table import, a non-goal), so the only
document that becomes a sheet is the empty one just created.

## 5. Vault and export

The note file carries `kind: sheet` in its frontmatter and the Markdown table
as its body. Beside it, `<Title>.csv` holds the grid (RFC 4180, CRLF, UTF-8,
no BOM; trailing empty rows trimmed, every column kept), opening in any
spreadsheet. It follows the note through renames, the trash, and deletes
under the same rules as a whiteboard's `.excalidraw` file, and its hash goes
in `board_sha`. Column widths are not in the CSV; they live only in the
database, which is authoritative.

The mirror's canvas code is keyed on the `.excalidraw` extension
(`canvas_rel`, `note_rel_of_canvas`, `board_claims`, the `canvas` field of
`VaultNote`, and the export). It generalises to one surface sidecar whose
extension follows the kind (`.excalidraw` for a whiteboard, `.csv` for a
sheet), so write, rename, trash, tombstone, and export each handle the
sidecar once rather than twice.

Export Note writes a sheet as `.csv`; the vault export writes the sidecar.

## 6. Agents (decided 2026-10-04: ship `append_sheet_rows`)

The use case pairs a sheet with an agent running in another editor, so the
design goes one step past whiteboards:

- `update_note` and `append_to_note` refuse a sheet's body, as they refuse a
  whiteboard's: the body is derived, and a write to it would be thrown away on
  the next save.
- `get_note` on a sheet returns the Markdown table, which agents already
  read, plus `sheet: { rows, cols }` so the agent knows the width before it
  appends.
- **New tool `append_sheet_rows(id, rows: string[][])`**, write level, not
  destructive, not idempotent. Rows shorter than the sheet are padded with
  `""`; a row wider than the sheet is refused with the column count, so an
  agent cannot widen the sheet's shape. Rows land after the last non-empty
  row, reclaiming the default grid's trailing empty rows, so the first append
  to a new sheet fills row 2, not row 21. Past 5,000 rows or 10,000 characters
  in a cell the call is refused. Like `append_to_note` it reads, appends, and
  writes with the version check, retrying on conflict. It returns the note
  view with the first appended row's index.

Append is the only agent write to a sheet. That is what makes two writers
safe: the library's `#adoptExternal` today skips whiteboards and keeps the
open note's `surfaceData`; for a sheet it reads the fresh note (surface
included) and, with nothing unsaved, replaces the grid, as the editor applies
an agent's text change. With unsaved cells the grid merges instead of
yielding: the fresh sheet's rows beyond the grid's last known row are the
agent's and are appended to the local grid, then the save goes out with the
fresh `updatedAt`. No column, width, or existing cell can have changed under
the user, so nothing is lost on either side and nothing is "offered back".
The sticky store follows the same rule for a popped-out sheet.

## 7. Where it sits

It changes note shape (a new kind) but adds no column and no migration, and
the vault serializer already handles a surface sidecar. It takes the next
slot after the open 13x units, as `13h`.

## 8. Review findings (2026-10-04)

What the review of the proposal against the code changed, beyond the four
questions in tasks.md:

1. **One serializer, in Rust.** The proposal had `markdown.ts` and `csv.ts`
   in the frontend and an agent tool that also "rewrites the body". That is
   two GFM serializers. Moved to `core/src/sheet.rs`; `update_note` derives
   the body (§2, §4).
2. **Agent writes do not reach an open sheet for free.** `#adoptExternal`
   returns early for a whiteboard and keeps the UI's `surfaceData` for
   documents. A sheet needs its own branch, and the append-only rule makes
   its merge mechanical (§6).
3. **The grid is a typing target, not a board target.** Treating it as a
   board would make the window handler stand aside for every key, which is
   the opposite of the focus contract (§3).
4. **A cell cap.** 52 columns and 5,000 rows bound nothing without a
   per-cell limit (§1).
5. **The sidecar code generalises rather than duplicates.** Five places in
   the mirror and the export know the `.excalidraw` extension (§5).
6. **No status line.** The editor's status bar shows save state; limits are
   reported by toast (§1).
7. **Creation reuses conversion.** `newWhiteboard` is create-then-patch;
   "New sheet" does the same, and the store allows `document` -> `sheet`
   one way (§4). No separate create path.
8. **Working rule.** Five units (13c to 13g) are BUILT and open until checked
   in the app. SEQUENCE.md allows one unit in flight. Building 13h before
   they archive needs either those checks done or the exception recorded, as
   13d and 13e recorded theirs.
