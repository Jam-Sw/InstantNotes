# Change: Image Handling

## Why

0.8.0 let a user paste or drop an image into a note. That left three things
unanswered: where the file lives, how big it renders, and what happens to it
when the note is copied out as context. This change answers all three.

The code is written and works. This change is the remaining distance to done.

## What Changes

Already built on `0.9.0-pre` (`44bea94`):

- An Images settings page: copy-into-app vs link-in-place, preview height, and
  a button revealing the attachments folder
- Insert an image from a file via the editor toolbar, alongside paste and drop
- Four IPC commands: `import_image_file`, `allow_image_file`,
  `open_attachments_folder`, plus `attachments_stats` feeding the dashboard
- Contexting rewrites images to absolute paths (new default), leaves them as
  written, or drops them, when copying a note as context
- `editor/images.test.ts` (15 tests) and `contexting-format.test.ts` (12 tests)

## Remaining to done

- `SettingsImages.svelte` is 210 lines with no test
- `import_image_file`, `allow_image_file`, and `open_attachments_folder` are
  undocumented in `docs/API.md`
- **One open decision, below**

## The open decision: "link" mode versus a portable vault

Link mode leaves the image at its original path and references it from the note.
`feat-portable-vault-sync` guarantees the vault carries the complete saved state
to any device. A linked image is outside the vault by definition, so a note that
uses one is not portable, and on a second device the reference is broken.

Three ways out, to be chosen in this unit:

1. **Drop link mode.** Always copy. Simplest, and the guarantee holds
2. **Copy on vault export.** Link mode stays a local convenience; the vault
   always materializes the bytes. The note body then differs from the vault copy
3. **Accept the hole.** Link mode is documented as opting a note out of
   portability

Chosen here rather than during the vault work, because the vault serializer
encodes the answer and changing it afterwards migrates user data.

## Non-goals

- No image editing, cropping, or compression
- No attachment garbage collection — that is a separate unit after the vault

## Impact

Settles how images are stored before the vault serializes them. Whichever way
the link decision goes, it is made once and recorded.
