# Tasks: Sheet Notes

A third note kind on the existing columns; no migration. The vault gains a
`.csv` sidecar beside the whiteboard's `.excalidraw`. See `SEQUENCE.md` §13h.

## Decide first

- [ ] Proposal reviewed and approved by the owner
- [ ] Agent write tool: ship `append_sheet_rows`, or refuse sheet writes only
      (design.md §6)
- [ ] Limits: 52 columns, 5,000 rows (design.md §1)
- [ ] Enter in select mode starts editing (Sheets) rather than moving down
      (Excel)

## Build

- [ ] Core: `CONTENT_KIND_SHEET`; `update_note` accepts it, lets sheets hold
      `surfaceData`, refuses converting a sheet, validates the envelope and
      limits
- [ ] Core: create-note path for a sheet with the default grid and a frozen
      title
- [ ] Vault: `kind: sheet` frontmatter, `.csv` sidecar through write, rename,
      trash, delete, tombstones; `board_sha` documented as the surface file hash
- [ ] Export Note writes `.csv` for a sheet
- [ ] `src/lib/sheet/`: `model.ts`, `selection.ts`, `keys.ts`, `markdown.ts`,
      `csv.ts`
- [ ] `SheetGrid.svelte`: rendering, both modes, mouse selection, column
      resize, header context menus, TSV clipboard, undo/redo, row windowing past
      200 rows, theme tokens only
- [ ] Save path: `{ surfaceData, body }` through `SaveQueue`; flush on switch,
      pop-out, trash, quit
- [ ] `NoteEditor` and the sticky route mount `SheetGrid` for a sheet;
      `NoteList` shows a sheet icon
- [ ] Entry points: palette "New sheet", File > New Sheet
- [ ] Agents: refuse body writes to a sheet; `append_sheet_rows` if decided
- [ ] Docs: `DATA_MODEL.md` §3.2 and §10, `API.md`, changelog, spec
      requirement, `SEQUENCE.md` §13h

## Verify

- [ ] `cargo test --workspace` (validation, limits, vault sidecar round trip,
      agent refusal and append)
- [ ] `npm test` (model ops and their inverses, movement, keys table, Markdown
      and CSV escaping, TSV paste, shortcut pass-through against the command
      registry, save on switch)
- [ ] `npm run check`
- [ ] In the app: log twenty rows by keyboard alone in a popped-out sheet
      beside another app; paste a range from Google Sheets; quit mid-edit and
      relaunch; check the vault `.md` and `.csv`
