# Change: Graph View

## Why

The staged plan runs notes, then graph and structure, then local AI (SEQUENCE.md
units 13 and 14). With the notes foundation solid, the library should be
visible as a whole: which notes share which tags and Spaces, and where the
clusters are. A graph is also where local AI results will have somewhere to
surface later.

## What Changes

- A Graph place in the sidebar, next to All Notes and Revisit, that fills the
  list and editor area.
- Nodes are live notes, tags, and Spaces; each note links to the tags and
  Spaces it carries. Hovering or focusing a node lights its neighborhood.
- Choosing a note opens it, a tag filters by it, and a Space opens it.
- It opens framed around the open note's neighborhood; "Show all" fits the
  whole library. Pan by dragging, zoom with the wheel or a pinch.

## Non-goals

- Links between notes. That is a body syntax, with its own editor, rename,
  and vault questions, and was decided out of this change (2026-09-22).
- Storing anything: no edge table, no saved positions.
- Trashed and archived notes, which stay out of view here as everywhere else by
  default.
