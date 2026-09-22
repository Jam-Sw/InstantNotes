# Change: Whiteboard Notes

## Why

Planning and systems thinking often need a spatial canvas: boxes, arrows,
frames, freehand. InstantNotes should support that without becoming a separate
diagrams app or adding a new top-level destination. The unit stays a note:
a note can become a whiteboard, so capture, the library, tags, Spaces, search,
and the vault all keep working on it.

Pre-release builds carried a first version on `feat/note-whiteboard`, and it
was lifted off `0.9.0-pre` with four recorded defects (SEQUENCE.md unit 12).
This change brings it back with those defects fixed and the canvas made
portable through the vault.

## What Changes

- Notes carry a `contentKind` of `document` (default) or `whiteboard`; a
  board's canvas lives in `surfaceData` as a versioned Excalidraw envelope.
- The canvas engine is Excalidraw, loaded on first use only.
- A board's `body` is the text written on it, in reading order, rewritten on
  every save. Search, inline `#tags`, list previews, and the vault's Markdown
  file all see what the board shows.
- Converting a document is one-way and confirms first. Its text moves onto the
  board as a text block, so nothing written disappears. "New whiteboard"
  creates one directly (palette, File menu, `Cmd+Shift+N`).
- Board edits go through the same save queue as body edits: debounced,
  retried once, flushed on note switch, trash, and quit.
- The vault writes each board's canvas as a standard `.excalidraw` file
  beside its note file, under the mirror's ownership rules. Export Note writes
  a board as `.excalidraw`.

## Non-goals

- Converting a whiteboard back into a document.
- Multiplayer, or reading edited `.excalidraw` files back from the vault
  (that is vault stage 3).
- Excalidraw's own file menu, image export, and online features: a board is a
  note, and saves and exports as one.

## Impact

Notes stay the canonical unit. Schema v4 (the pre-release columns) is carried
unchanged; v6 adds the canvas hash the vault mirror needs. No existing note
changes shape.
