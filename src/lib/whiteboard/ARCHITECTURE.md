# Note whiteboard surfaces

Whiteboards are a **surface mode on a note**, not a separate product area.
Capture, library, tags, and spaces stay the same. The open note either shows
the markdown editor (`contentKind: "document"`) or a canvas host
(`contentKind: "whiteboard"`).

## Why this shape

- Notes remain the unit of identity and organization.
- Markdown `body` stays human-readable and FTS-searchable; convert does not
  stuff engine JSON into the body.
- Engine payloads live in `surfaceData` so libraries (tldraw, Excalidraw, …)
  can own their document format without InstantNotes inventing one.
- Convert-back keeps `surfaceData` so re-opening the whiteboard restores the
  board without a second persistence model.

## Modules

- `types.ts` — surface document envelope and adapter contracts
- `document.ts` — pure helpers: empty shell doc, parse/serialize, engine id
- `registry.ts` — adapter lookup (shell today; real engines later)
- `components/whiteboard/WhiteboardSurface.svelte` — note chrome host
- `components/whiteboard/ShellCanvas.svelte` — placeholder canvas (no engine)

## Adapter contract

An adapter mounts into a host element, owns interaction, and reports document
changes as opaque JSON (stringified into `surfaceData`). InstantNotes owns
chrome (title, tags, convert) and persistence; the adapter owns the canvas.

```
NoteEditor
  ├─ document  → Editor (CodeMirror)
  └─ whiteboard → WhiteboardSurface
                    └─ adapter.mount(host, { data, onChange, readonly })
```

## Adding an engine

1. Implement `WhiteboardAdapter` (mount / dispose / optional focus).
2. Register it in `registry.ts`.
3. Prefer writing a new empty document with that engine id when converting.
4. Do not add a sidebar section or capture branch for whiteboards.

## Non-goals here

Connectors, freehand ink, multiplayer, and engine UIs belong to the plugged-in
library, not InstantNotes chrome.
