# Change: Note Whiteboard Surface

## Why

Planning and systems thinking often need a spatial canvas: nodes, frames, and
connections. InstantNotes should support that without becoming a separate
"diagrams app" or bloating the sidebar with a new top-level destination. The
right unit is still a note: convert a note into a whiteboard surface (and back),
so capture, library, tags, and spaces stay the same.

This change lays the product and technical groundwork only. It does not ship a
full flowchart engine. Existing canvas libraries (tldraw, Excalidraw, and peers)
should plug into a stable host later.

## What Changes

- Notes gain a `contentKind` of `document` (default) or `whiteboard`
- Whiteboard engine payload lives in `surfaceData` (JSON); markdown `body`
  remains human-readable and searchable, and is preserved across convert
- In the open note, convert between document editor and whiteboard surface
- Command palette: convert actions for the selected note
- A pluggable whiteboard host with a shell adapter (empty canvas chrome) so
  engines can mount without redesigning note chrome
- Subtle list cue when a note is a whiteboard

## Non-goals (this change)

- No new sidebar section or capture path for whiteboards
- No third-party diagram library dependency yet
- No connectors, freehand drawing, or iPad ink (later, via engines)
- No multiplayer or cloud sync for surfaces

## Impact

Notes stay the canonical unit. Whiteboard is a surface mode on a note, not a
parallel product. Later engine work swaps the shell adapter without reworking
library, tags, spaces, or persistence contracts.
