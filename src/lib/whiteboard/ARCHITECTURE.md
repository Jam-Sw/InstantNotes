# Note whiteboard surfaces

Whiteboards are a **surface mode on a note**, not a separate product area.
Convert is one-way (document → whiteboard). The canvas is **freeform**: boxes,
arrows, freehand, frames — not a rigid node graph.

## Current engine

**Excalidraw** (`@excalidraw/excalidraw`), mounted as a React island from
`ExcalidrawCanvas.svelte`. New boards start **empty**.

## Modules

- `document.ts` — empty scene, parse/serialize envelope
- `components/whiteboard/WhiteboardSurface.svelte` — note chrome
- `components/whiteboard/ExcalidrawCanvas.svelte` — freeform host

## Envelope

```json
{ "v": 1, "engine": "excalidraw", "data": { "elements": [], "appState": {}, "files": {} } }
```

Legacy `shell` / `svelte-flow` rows open as a blank freeform board.
