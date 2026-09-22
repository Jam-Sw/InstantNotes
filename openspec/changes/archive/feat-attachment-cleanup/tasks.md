# Tasks: Image Cleanup

SEQUENCE.md unit 11. Landed on `0.9.0-pre` on 2026-09-22.

## Decide first

- [x] When to remove. **At permanent delete, plus an explicit sweep**, never
      on a timer or at launch. A permanent delete is the moment the user has
      said "gone for good", and it has no undo. A background sweep would race
      the editor's own undo, which can restore a reference the user just
      deleted. The sweep for older leftovers is a button in Settings > Images
      that confirms first.
- [x] Before unit 9, not after. The sequence placed this after the vault flips
      authority "because every reference and every file is visible in one
      place". Every reference is already in SQLite: note bodies, whiteboard
      canvases, and the capture draft setting. Nothing about the fix needed
      the vault.
- [x] What counts as a reference. Any `attachments/<name>` in a note's body or
      a whiteboard's canvas, or in the capture draft; matched without regard
      to case, because the disks attachments live on usually ignore it. Wider
      than image syntax on purpose: a false match keeps a file, a missed one
      would lose it.

## Safety

- [x] The store stays locked from the reference check to the file removal, so
      no save can start using an image mid-cleanup
      (`Store::remove_unreferenced_attachments` re-checks every candidate
      itself rather than trusting the caller)
- [x] Only plain file names are ever removed: no separators, no `.` or `..`
- [x] The vault's copy goes only while it holds the same bytes; a copy changed
      outside the app stays
- [x] The sweep skips images added in the last hour: a fresh paste can belong to
      an edit that has not saved yet
- [x] A cleanup failure never fails the delete that triggered it

## Build

- [x] Core: `attachments.rs` (finding references, removing one file, listing
      the folder) and `store/attachments.rs` (what is still referenced;
      checked removal). `core/tests/attachments_test.rs`, 15 tests, real
      SQLite and real folders
- [x] Shell: `permanently_delete_note` and `destroy_notes` clean up under the
      store lock; `unused_attachments` and `remove_unused_attachments` back
      the sweep
- [x] Settings > Images: an "Unused" line in the Stored images card and a
      "Remove unused…" button that confirms first
      (`SettingsImages.test.ts`)
- [x] Docs: `API.md` §8, `CHANGELOG.md`, `spec.md` (Image Cleanup)
