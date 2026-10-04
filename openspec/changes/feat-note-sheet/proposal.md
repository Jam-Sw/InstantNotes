# Change: Sheet Notes

## Why

Work in another editor produces small tabular facts that have nowhere to go:
test readings, timings, before/after metrics, a scratch log of what was tried.
A Markdown table is the wrong tool for this. Typing pipes, padding columns, and
keeping rows aligned is exactly the friction the moment cannot afford. A
spreadsheet app is the wrong tool too: it is a separate window with its own
chrome, its own focus rules, and its own file.

A sheet note is a cell grid that stays a note. It has the muscle memory of
Google Sheets or Excel: type into a cell, Tab across, Enter down, and a new row
appears at the bottom. It pops out as a sticky beside the editor and does not
fight InstantNotes for the keyboard, the theme, or the window.

## What Changes

- Notes gain a third `contentKind`, `sheet`, beside `document` and
  `whiteboard`. A sheet's grid lives in `surfaceData` as a versioned envelope.
- The grid is written in-house as Svelte DOM: a real table of real elements,
  styled only by the app's theme tokens. No third-party grid or spreadsheet
  library, no canvas rendering, no React, no toolbar ribbon.
- Editing follows the spreadsheet model: select mode and edit mode, keyboard
  first, mouse fully supported (design.md §3).
- The grid model (pure TypeScript) is separate from the grid view (Svelte). The
  view reads what each cell shows through one function, so a headless formula
  engine can later compute cell values without changing the view (design.md
  §2).
- A sheet's `body` is its grid as a GitHub-flavored Markdown table, derived
  by the store from `surfaceData` on every save (one serializer, in Rust). Search, inline `#tags`, list previews, the graph, filing
  suggestions, MCP reads, and the vault's Markdown file see what the sheet
  holds.
- "New sheet" creates one directly (palette, File menu). Sheets pop out as
  stickies like any note.
- The vault writes a sheet's grid as a `.csv` file beside its note file, under
  the mirror's ownership rules. Export Note writes a sheet as `.csv`.
- Grid edits go through the existing `SaveQueue`: debounced, retried once,
  flushed on note switch, pop-out, trash, and quit.

## Non-goals

- Formulas in v1. A cell whose input starts with `=` is stored and shown
  exactly as typed. The model leaves room for an engine (design.md §2), but no
  engine, parser, or stub ships in this change.
- Turning an existing Markdown table into a sheet, or a sheet back into a
  document. Markdown tables inside documents stay Markdown and are untouched.
- Cell formatting (bold, colors, number formats), merged cells, frozen panes,
  multiple tabs per sheet, charts, sorting, filtering.
- `.xlsx` import or export.
- Reading edited `.csv` files back from the vault (vault stage 3).

## Impact

- Core: `CONTENT_KIND_SHEET` in `types.rs`; `update_note` validation in
  `store/notes.rs` (sheets hold `surfaceData`, a sheet never converts to
  another kind); vault mirror writes the `.csv` sidecar in `store/vault.rs`.
  **No column**: `content_kind` is validated in code, not by a CHECK, and the
  sidecar's hash reuses `board_sha`, which `DATA_MODEL.md` describes as the
  hash of the note's surface file rather than of a canvas only. One trigger
  migration (v12) was needed after all: the v6 hard-delete trigger tombstones
  the sidecar as `.excalidraw` by name, and a sheet's is `.csv`.
- Core: `core/src/sheet.rs` (new): envelope validation, the Markdown table,
  CSV, and row append, shared by the store, the vault, and the agent tool.
- Agents: `src-tauri/agents/src/tools.rs` refuses body edits to a sheet as it
  does to a whiteboard, and adds `append_sheet_rows` (design.md §6; decided
  2026-10-04). The library and sticky stores take an agent's appended rows
  into an open sheet.
- Frontend: `src/lib/sheet/` (model, selection, keys, TSV, new),
  `src/lib/components/sheet/SheetGrid.svelte` (new), `NoteEditor.svelte`,
  `NoteList.svelte`, `commands.ts`, `+page.svelte` (typing-target rule), the
  sticky route, `api/types.ts`.
- Shell: File > New Sheet menu item.
- Docs: `DATA_MODEL.md` §3.2 and §10, `API.md`, `CHANGELOG.md`, and a
  `Sheet Notes` requirement in `openspec/specs/instantnotes/spec.md`.

## Requirement (to add to `specs/instantnotes/spec.md`)

### Requirement: Sheet Notes
The app SHALL let a note be a sheet, a cell grid that stays a note: listed,
tagged, filed in Spaces, trashed, popped out, and searched like any other.

#### Scenario: Log a row without leaving the keyboard
- **WHEN** the user types into the last row of a sheet, presses Tab between
  cells, and presses Enter
- **THEN** each value lands in the next cell to the right
- **AND** a new empty row appears, with the selection in the column where the
  Tab run started

#### Scenario: Search a sheet
- **WHEN** the user searches for a value typed into a cell
- **THEN** the sheet appears in the results

#### Scenario: App shortcuts still work
- **WHEN** a cell is selected or being edited and the user presses an app
  shortcut such as the command palette or pop-out
- **THEN** the app shortcut runs, and the grid does not swallow it

#### Scenario: Never lose the last cell
- **WHEN** the user types into a cell and immediately switches notes, pops the
  sheet out, trashes it, or quits
- **THEN** the typed value is saved

#### Scenario: An agent logs rows
- **WHEN** an agent calls `append_sheet_rows` on a sheet that is open in the
  app with nothing unsaved
- **THEN** the rows appear at the bottom of the grid without a reload
- **AND** `update_note` and `append_to_note` on the same sheet are refused

#### Scenario: A sheet in the vault
- **WHEN** a vault folder is set and a sheet is saved
- **THEN** the vault holds the note file, whose body is a Markdown table, and
  a `.csv` file beside it with the same name
