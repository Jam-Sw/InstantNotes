# Tasks: Whiteboard Notes

SEQUENCE.md unit 12. Landed on `0.9.0-pre` by decision (2026-09-22), after
vault stages 1 and 2, which is the order unit 12 asked for: the canvas file is
additive to a vault format that already exists.

## Decide first

- [x] The engine: **Excalidraw** (`@excalidraw/excalidraw` 0.18, React 18). The
      pre-release branch wired Svelte Flow, then swapped to Excalidraw without
      choosing. Excalidraw wins on the thing that matters most here: its file
      format is an open, documented standard that other tools read, so the
      vault's canvas file is useful outside InstantNotes. Svelte Flow has no
      file format of its own; its nodes would be ours to define and nobody
      else's to open. React 18, not 19: Excalidraw's Radix UI dependencies
      declare React 18 at most.
- [x] What a board's `body` is. **The text on the board**, in reading order
      (`boardText`, `src/lib/whiteboard/document.ts`), written with every save.
      Search, inline tags, previews, and the vault's `.md` then describe what
      the board shows. This designs away defect 4 below instead of patching
      the dialog.
- [x] Whether a board's title follows its body. **No**: converting freezes an
      auto title (`update_note`, `store/notes.rs`), since the body is rewritten
      whenever a shape moves.

## The four defects from the pre-release branch

- [x] **1. Silent canvas data loss.** The old canvas cleared its save timer on
      unmount without firing it, and quit never asked it for its edit. Board
      edits now go through the library's save queue like body edits (the queue
      holds `{ body }` or `{ surfaceData, body }`), and the canvas registers an
      `onBeforeFlush` hook that the library runs before every flush, trash, and
      note switch. Unmounting hands the waiting edit over too. Pinned by
      `WhiteboardCanvas.test.ts` ("hands a waiting edit over when the board
      closes", mutation-checked) and the store's whiteboard tests.
- [x] **2. Dead engine abstraction.** `registry.ts` and the adapter interfaces
      are not carried over. One engine, used directly.
- [x] **3. Theme ignored.** The board follows the app's effective light or dark
      variant, live, without remounting (`NoteEditor.svelte`,
      `effectiveVariant`).
- [x] **4. Convert hid searchable text.** Converting now lays the note's text
      onto the board as a text element (`boardFromText`), and the body is the
      board's text from then on, so every search hit is visible on the board.
      The dialog says so.

## Build

- [x] Core: `content_kind` and `surface_data` on `Note` and `UpdateNotePatch`;
      one-way convert and "only a board holds a canvas" enforced in
      `update_note`; list rows leave the canvas out, and the `update_note` IPC
      reply drops it, since a board can hold pasted images
      (`core/tests/whiteboard_test.rs`)
- [x] Vault: `kind: whiteboard` in frontmatter, the canvas as a standard
      `.excalidraw` file beside the note file, moved, trashed, and deleted with
      it under the mirror's ownership rules, and checked by Check vault
      (`vault/board.rs`, migration v6's `board_sha`,
      `core/tests/vault_board_test.rs`)
- [x] Canvas: `WhiteboardCanvas.svelte`, loaded on first use; saves only on a
      changed scene fingerprint (scrolling and selecting are not edits); drops
      deleted elements and unused images from what it saves; opens web links
      in the browser
- [x] Keys: a board owns arrows, `Cmd+A`, `Cmd+=`, and Backspace; the library
      window's shortcuts stand aside for them (`whiteboard/keys.ts`), so an
      arrow press cannot switch notes and `Cmd+Backspace` cannot trash the
      board
- [x] Entry points: "New whiteboard" (palette, File menu, `Cmd+Shift+N`) and
      "Turn into whiteboard…" (palette, confirms); a board cue in the list
- [x] Export Note writes a board as `.excalidraw`
- [x] Offline fonts: `scripts/copy-excalidraw-fonts.mjs` copies Excalidraw's
      fonts into `static/excalidraw/` before dev and build; without them
      Excalidraw would reach for a CDN, which the CSP blocks. The CJK face
      (Xiaolai, 12 MB) is left out; CJK text renders in the system font
- [x] Docs: `DATA_MODEL.md` (v6, the canvas file), `API.md` (fields, reply,
      menu event, export), `CHANGELOG.md`, `spec.md` (Whiteboard Notes)

## Left for a real run

- Pasting an image onto a board. Excalidraw resizes images in a `blob:`
  worker, which the CSP (no `worker-src`) blocks; it is expected to fall back
  to resizing on the main thread. Confirm before widening the CSP.
