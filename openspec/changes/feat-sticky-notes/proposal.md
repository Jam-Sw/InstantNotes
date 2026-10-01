# Change: Sticky Notes

## Why

A note that matters right now (a phone number mid-call, a checklist for the
next hour, the paragraph being drafted) is buried in the library the moment
another window takes focus. Parking it somewhere visible is the "trusted
parking" promise stated as a window: the loop stays in view until it closes,
and goes back into the library when it does.

## What Changes

- Any note or whiteboard can pop out of the library into its own small,
  frameless window, and pop back in.
- A sticky sits at one of three levels, switchable from its header: above every
  window on every Space (`float`, the default), as an ordinary window
  (`normal`), or below every window on every Space like a desktop widget
  (`desktop`).
- Entry points: the Sticky button in the editor toolbar, right-click on a note
  row, the command palette, and File > Pop Out as Sticky (⌘⇧O), which toggles.
- Stickies reopen at launch where they were left. One whose note is gone or in
  the Trash is dropped; one saved on a display that is no longer attached is
  centered.

## Decisions

- **A sticky is a handoff, not a second view.** While a note is a sticky, its
  window is the note's only editor and the library shows a placeholder with
  Show Sticky and Bring Back. `update_note` is last-write-wins, so two live
  editors on one note would silently overwrite each other; one writer per note
  removes the problem instead of reconciling it. The one writer outside the
  app, an agent over MCP (`feat-agent-access`), reaches a sticky exactly as
  it reaches the library's open note: taken in place when nothing is unsaved,
  and offered back by name when typing replaced it.
- **Popping out writes first.** The library flushes every pending edit and
  refuses to pop out a note whose edit did not land, since the sticky loads
  from disk.
- **Popping in waits for the sticky.** The shell asks the sticky to flush and
  waits for its answer. A sticky whose save failed stays open with its text; a
  sticky that never answers (a hung webview) is closed after 1.5s.
- **Trash and destroy pop in first**, and do not go ahead if a sticky cannot
  save.
- **Quit waits for every window that holds edits**, not only the library.
- **Per-device window state, not note data.** One `stickies` row in the
  settings table. No migration, no vault change.

## Impact

- Shell: `src-tauri/src/shell/stickies.rs` (new), `shell/quit.rs`,
  `events.rs`, `lib.rs`, `capabilities/default.json`.
- Frontend: `src/routes/sticky/+page.svelte` and
  `src/lib/stores/sticky.svelte.ts` (new), `library.svelte.ts`,
  `NoteEditor.svelte`, `NoteList.svelte`, `commands.ts`, `+page.svelte`, and
  the API client, types, and events.
- Docs: `docs/API.md` §9.1, `docs/DATA_MODEL.md` §8, `CHANGELOG.md`.
