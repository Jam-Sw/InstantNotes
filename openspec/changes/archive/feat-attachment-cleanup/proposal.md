# Change: Image Cleanup

## Why

Pasted, dropped, and copied-in images are files under `<app data>/attachments`,
referenced from notes as `attachments/<name>`. Nothing ever removed one: a note
deleted for good left its images behind, and the folder only grew. The live
vault copies that folder, so the leftovers showed up there too
(`feat-portable-vault-sync/design.md` §14, open question 4).

## What Changes

- Deleting notes for good also removes the copied-in images only they
  referenced, and the vault's copy of each when it is unchanged.
- Settings > Images reports how many stored images no note uses, and removes
  them on request, for what older versions left behind.
- An image is kept while anything references it: any note in any state,
  including the Trash and the Archive, a whiteboard's canvas, or the capture
  draft.

## Non-goals

- Linked originals (the "Link original" storage mode). They are the user's
  files, not the app's, and are never touched.
- Removing images the moment a reference is deleted from a note's text. Undo
  in the editor can bring the reference back, so only a permanent delete, or
  the explicit Settings cleanup, removes a file.
