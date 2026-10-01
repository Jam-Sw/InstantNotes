# Tasks: Sticky Notes

Per-device window state on the existing settings table; no note shape change
and no vault change. See `SEQUENCE.md` §13c for where it sits.

## Decide first

- [x] Ownership. **A sticky is the note's only editor** (decided 2026-09-30);
      the library shows a placeholder, never a second live editor.
- [x] Storage. **One `stickies` settings row** (decided 2026-09-30), window
      state rather than note data.
- [x] Levels. **`float`, `normal`, `desktop`** (decided 2026-09-30). `desktop`
      is Tauri's always-on-bottom, which on macOS is the below-normal window
      level: under every app window, above the desktop icons.

## Build

- [x] `shell/stickies.rs`: window build, levels, pop out, pop in with the
      flush answer, restore at launch, geometry, reachability check
- [x] Quit handshake waits for the library and every sticky
- [x] `stickies:changed`, `sticky:close-requested`, `menu:toggle-sticky` on
      both sides of the event registry
- [x] Sticky window route and store (reusing `SaveQueue`)
- [x] Library: sticky set, pop out after a confirmed flush, reopen on pop in,
      edit guards, pop in before trash and destroy
- [x] Entry points: toolbar button, row context menu, palette, File menu
- [x] Docs: API.md §9.1, DATA_MODEL.md §8, changelog
- [x] Header behaves as a title bar (found 2026-09-30: stickies did not move).
      `core:default` does not grant `start_dragging`, so the drag region was
      denied; a `stickies` capability grants it to `sticky-*` only. The window
      accepts the first click, so an unfocused sticky drags in one gesture.
      Double-click collapses to the header, as Stickies does, instead of the
      drag region's zoom to full screen; collapsed state persists

## Verify

- [x] `cargo test --workspace` (reachability, labels, saved map, quit answers)
- [x] `npm test` (sticky store; library pop out, guards, pop in, trash)
- [x] `npm run check`
- [ ] In the app, against a copy of a real library: pop out, type, bring back,
      and the text is in the library
- [ ] Type in a sticky and quit at once; the text is there on relaunch
- [ ] Relaunch restores each sticky's position, size, and level
- [ ] Each level behaves as named, including across Spaces
- [ ] Trash a sticky's note from the library; the sticky closes first
- [ ] A whiteboard as a sticky keeps its last stroke on bring back
- [ ] Drag a sticky by its header, including while another app is in front;
      double-click the header to collapse and expand; relaunch keeps it
      collapsed
