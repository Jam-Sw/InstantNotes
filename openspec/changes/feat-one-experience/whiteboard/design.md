# Design: The whiteboard, finished

0.10.0 ships whiteboards as a note kind on Excalidraw. The owner's brief:
Apple Pencil, an easy QR code to join a whiteboard, note-taking on it,
better than GoodNotes. What "join" means here: open the same board on another
device, which sync already keeps the same; live co-editing is a non-goal.

## 1. Pen and touch

- Excalidraw reads pointer pressure for the pen tool and detects a pen
  (`penMode`): with a pen in use, fingers pan and zoom and do not draw. The
  canvas container gets `touch-action: none` so the browser never scrolls
  under a stroke; pinch zoom stays Excalidraw's.
- On a touch device a new board opens with the pen tool selected
  (`activeTool: freedraw` in the initial state), so note-taking starts on
  the first touch; on the desktop the selection tool stays first.
- Grid paper is Excalidraw's grid mode, already kept per board in
  `appState.gridSize`; the board's menu keeps it.
- The board fills the pane on the phone and the tablet (the mobile unit's
  layout); Excalidraw's own small-screen toolbar is used as it is.

## 2. Open on another device

A new command, `note.openElsewhere`, and an icon in the editor header for
every note kind, boards first:

- With Sync server on: a dialog with a QR code of
  `https://<server>/#note=<id>` and the link to copy. Scanned on a phone, it
  opens the web app on the person's server, signs in if needed, and lands on
  that note. The server address is the one the device is signed in to; no
  other address is ever encoded.
- With Folder sync or Off: the dialog says what is needed ("Open this on
  your phone through a Sync server: Settings > Sync").
- The web app reads `#note=<id>` at start: it selects the note when it is
  present, and if it has not arrived yet it waits for the next
  `notes:changed` for up to a minute, then says the note is not on this
  device yet.

The QR drawing reuses `RecoveryKey.svelte`'s renderer, moved to
`src/lib/qr.ts`. `instantnotes://` deep links for the desktop and the native
apps are the mobile unit's later work; the QR carries the web address, which
every device can open.

## 3. Not in this change

Handwriting recognition, PDF import and annotation, notebooks and page
templates beyond grid, audio recording, and sharing a board with another
person. Recorded so the next brief starts from a list.

## 4. Checks

- `whiteboard/document.test.ts`: the initial state carries `freedraw` on
  touch and `selection` otherwise.
- `qr.test.ts`: a known string renders a known module count; `openElsewhere`
  builds the URL only from the signed-in address.
- `library.svelte.test.ts`: `#note=` selects, waits, gives up.
- In the app: the dialog on the desktop; the phone scanning it opens the
  board in Safari (owner, with his iPhone and iPad, Pencil checked there).
