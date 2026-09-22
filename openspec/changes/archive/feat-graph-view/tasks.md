# Tasks: Graph View

SEQUENCE.md unit 13. Landed on `0.9.0-pre` on 2026-09-22.

## Decide first

- [x] Edges. **Tags and Spaces only** (decided 2026-09-22). Notes cannot link
      to each other yet; adding `[[links]]` was offered and not chosen.
- [x] Place. **A Graph entry in the sidebar** that takes the list and editor
      columns, not a panel beside the note (decided 2026-09-22).
- [x] Derived, not stored. `Store::library_graph` reads the existing tables
      each time; the layout lives in the view. The sequence's condition for
      unit 13 staying where it is.

## Build

- [x] Core: `library_graph` (`store/graph.rs`), live notes only, every tag
      and Space, one link per membership (`core/tests/graph_test.rs`)
- [x] Layout: `src/lib/graph/layout.ts`. A d3-force layout seeded by node id
      with a seeded jitter source, so the same library draws the same way
      every visit. A refresh starts from the previous positions and runs cool,
      so adding a note barely moves the rest (under 4 px on average, tested).
- [x] Settling in frames. Measured: 300 ticks take about 1 s at 1,000 notes
      and 3.6 s at 3,000, so the view runs the layout in 12 ms slices across
      animation frames instead of blocking on it
- [x] View: `GraphView.svelte`. Nodes are buttons (keyboard reachable, named
      by kind and label); hubs are sized by how many notes they gather and
      always labeled; note titles show when zoomed in or lit. Boards draw as
      squares. Live refresh on note, tag, and Space changes, debounced
- [x] Store: `graphMode`, entered with `selectGraph` and left by every other
      place and by opening a note; the list's arrow keys stand down while
      the list is hidden
- [x] Entry points: sidebar Graph, palette "Show graph"
- [x] Docs: `API.md`, `CHANGELOG.md`, `spec.md` (Graph View, and the sidebar
      in Library Organization)
