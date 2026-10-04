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
- Limits that keep it a companion, not a database: 52 columns, 5,000 rows.
  Past them, Enter stops appending and the status line says why. Both numbers
  are checked by the Rust validation too, so a bad write over MCP cannot exceed
  them.

Strings only, deliberately. Typed values (number, date) are what a formula
engine produces; storing them now would mean deciding the engine's type system
before the engine exists.

## 2. Model, view, and the seam for formulas

```
src/lib/sheet/
  model.ts       Sheet type, pure edit operations (setCell, insertRow,
                 deleteRows, insertCol, deleteCols, resizeCol, pasteBlock),
                 each returning a new Sheet plus its inverse for undo
  selection.ts   active cell, anchor, range; pure movement functions
  keys.ts        keydown -> intent, pure and table-tested
  markdown.ts    Sheet -> GFM table (the body)
  csv.ts         Sheet <-> CSV (vault sidecar, export) and TSV (clipboard)
src/lib/components/sheet/
  SheetGrid.svelte   the DOM grid; owns focus, renders, dispatches intents
```

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
registry, so a future app shortcut that collides fails CI instead of silently
losing to the grid.

**Rendering.** One `<table>` of `<td>` elements; the cell being edited holds a
single `<input>` (a `<textarea>` once it contains a newline). Only one input
exists at a time, so the DOM stays light. Rows outside the scroll viewport
are not rendered once a sheet passes 200 rows (fixed row height, spacer rows
above and below). All colors, borders, and fonts come from the theme's CSS
variables, so light, dark, and custom themes apply with no sheet-specific
theme code.

## 4. Saving

A grid edit produces a new `Sheet`; `SheetGrid` hands
`{ surfaceData, body }` to the note's `SaveQueue` exactly as
`WhiteboardCanvas` does. `body` is `markdown.ts`'s output. Undo history lives
in the component and is not persisted.

`body` is a GFM table using row 1 as the header row, trailing empty rows and
columns trimmed, pipes and newlines in cells escaped. An all-empty sheet has an
empty body. As with whiteboards, a sheet's title is frozen on creation
(`title_is_auto = 0`, default "Untitled sheet") since the body moves with every
cell.

## 5. Vault and export

The note file carries `kind: sheet` in its frontmatter and the Markdown table
as its body. Beside it, `<Title>.csv` holds the full grid (RFC 4180, UTF-8,
no BOM), opening in any spreadsheet. It follows the note through renames, the
trash, and deletes under the same rules as a whiteboard's `.excalidraw` file,
and its hash goes in `board_sha`. Column widths are not in the CSV; they live
only in the database, which is authoritative.

Export Note writes a sheet as `.csv`.

## 6. Agents (needs review)

The use case pairs a sheet with an agent running in another editor, so the
proposal goes one step past whiteboards:

- `update_note` and `append_to_note` refuse a sheet's body, as they refuse a
  whiteboard's: the body is derived, and a write to it would be thrown away on
  the next save.
- `get_note` on a sheet returns the Markdown table, which agents already read.
- **New tool `append_sheet_rows(note_id, rows: string[][])`** appends rows to
  the sheet, padding or refusing rows wider than the sheet, and rewrites the
  body. It reaches an open or popped-out sheet the same way agent writes reach
  an open note today (`feat-agent-access`): taken in place when nothing is
  unsaved, offered back otherwise.

If you'd rather keep agent writes out of v1, the tool drops out and the first
two bullets stay.

## 7. Where it sits

It changes note shape (a new kind) but adds no column and no migration, and
the vault serializer already handles a surface sidecar. It takes the next
slot after the open 13x units, as `13h`.
