# Tasks: Sheet Notes

A third note kind on the existing columns; one trigger migration (v12, no
column) so a destroyed sheet's `.csv` is tombstoned. The vault gains a `.csv`
sidecar beside the whiteboard's `.excalidraw`. Built on `0.9.4-pre` on
2026-10-04. See `SEQUENCE.md` §13h.

## Decide first

Reviewed 2026-10-04. Every question below is decided; the review's findings
are folded into design.md §8 and the Build list.

- [x] Proposal reviewed. **Approved for build, with the findings in design.md
      §8 carried into the tasks** (decided 2026-10-04). It starts only once the
      five 13c-13g units are checked in the app and archived, or the owner
      records a second open unit as an exception in SEQUENCE.md.
- [x] Agent writes. **Ship `append_sheet_rows`** (decided 2026-10-04). The
      use case is an agent beside the editor logging rows; refusing writes
      would ship the use case without its second half. Append is the only
      agent write to a sheet, which keeps the two-writers merge mechanical
      (design.md §6). `update_note` and `append_to_note` refuse a sheet's body.
- [x] Limits. **52 columns (A-AZ), 5,000 rows, 10,000 characters per cell**
      (decided 2026-10-04). The cell cap is new: without it a single cell can
      hold a megabyte and the row and column caps bound nothing. All three are
      enforced in Rust so no writer, MCP included, can exceed them.
- [x] Enter in select mode. **Starts editing (Sheets)** (decided 2026-10-04).
      It matches "any printable key starts editing", and the log-a-row loop
      (type, Tab, Tab, Enter) never needs select-mode Enter to move.
- [x] One serializer. **The Markdown body is derived in Rust from
      `surfaceData` on every sheet save; the frontend never sends a sheet's
      body** (decided 2026-10-04). Two serializers, one in TS for the editor
      and one in Rust for the agent tool, would have to agree byte for byte or
      the vault file churns. CSV lives in Rust for the same reason; only the
      TSV clipboard format is TS (design.md §4).
- [x] Scope left out of v1. **As proposed** (decided 2026-10-04): formulas,
      cell formatting, merged cells, frozen panes, sorting and filtering,
      `.xlsx`, Markdown-table import. Multi-line cells (Alt+Enter) stay in.

## Build

- [x] Core: `CONTENT_KIND_SHEET`; `update_note` accepts it, lets sheets hold
      `surfaceData`, allows `document` -> `sheet` one way (how "New sheet"
      creates one, as `newWhiteboard` does), refuses converting a sheet,
      validates the envelope and the three limits
- [x] Core: `core/src/sheet.rs`: parse the envelope, GFM table (`body`), CSV
      (sidecar, export), `append_rows`; `update_note` derives a sheet's body
      from its `surfaceData` and ignores a body sent with it
- [x] Core: create path yields the default 3 x 20 grid and a frozen title
- [x] Vault: generalise the whiteboard's canvas sidecar to a surface sidecar
      (`board.rs` -> `surface.rs`: extension by kind, `canvas_rel`,
      `note_rel_of_canvas`, `board_claims` take the kind); `kind: sheet`
      frontmatter; `.csv` through write, rename, trash, delete, tombstones;
      `board_sha` documented as the surface file hash
- [x] Export Note writes `.csv` for a sheet; vault export writes the sidecar
- [x] `src/lib/sheet/`: `model.ts`, `selection.ts`, `keys.ts`, `tsv.ts`
- [x] `SheetGrid.svelte`: rendering, both modes, mouse selection, column
      resize, header context menus, TSV clipboard, undo/redo, row windowing past
      200 rows, theme tokens only, limit toast. Two mechanics differ from the
      design's wording, to the same effect: copy, cut, and paste are taken as
      clipboard events on the focused element (so the Edit menu reaches the
      grid too) rather than as ⌘C/X/V keydowns, and undo keeps snapshots of
      the grid (each edit shares the rows it did not touch) rather than
      inverses
- [x] Save path: `{ surfaceData }` through `SaveQueue`; flush on switch,
      pop-out, trash, quit; `#adoptExternal` and the sticky store take an
      agent's rows into an open sheet (design.md §6)
- [x] Library window keys: `[data-sheet]` counts as a typing target in
      `+page.svelte`, not as a board target, so app shortcuts keep working
- [x] `NoteEditor` and the sticky route mount `SheetGrid` for a sheet;
      `NoteList` shows a sheet icon and "Empty sheet"
- [x] Entry points: palette "New sheet", File > New Sheet, note list menu
- [x] Agents: refuse body writes to a sheet; `append_sheet_rows`; `get_note`
      on a sheet carries `sheet: { rows, cols }`
- [x] Core: migration v12 recreates the hard-delete trigger so a sheet's
      `.csv` is tombstoned under its own extension (found while building: the
      v6 trigger hardcodes `.excalidraw`). No column
- [x] Docs: `DATA_MODEL.md` §3.2, §9, §10, §11, `API.md` §4, §9, §15,
      changelog, spec requirement, `SEQUENCE.md` §13h

## Verify

- [x] `cargo test --workspace` (validation, the three limits, body derived
      from the grid, GFM and CSV escaping, vault sidecar round trip, agent
      refusal, append padding and refusal, append fills trailing empty rows,
      revert of an append restores the grid, migration v12); `cargo clippy
      -D warnings` and `cargo fmt --check` as CI runs them
- [x] `npm test` (model ops, movement, keys table, TSV paste, shortcut
      pass-through against the command registry and the window handler's
      global keys, the grid's save path and key contract, save on switch,
      agent rows adopted into an open grid and merged on a conflicting save)
- [x] `npm run check`
- [ ] In the app: log twenty rows by keyboard alone in a popped-out sheet
      beside another app; paste a range from Google Sheets; quit mid-edit and
      relaunch; check the vault `.md` and `.csv`
