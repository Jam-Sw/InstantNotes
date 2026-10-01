# Change: Editor Settings and Editor State Fixes

## Why

Two small things that belong together because they touch the same files: a
settings page for editor preferences, and a fix for editor state leaking between
notes.

The code is written and works. This change is the remaining distance to done.

## What Changes

Already built on `0.9.0-pre` (`44bea94`):

- An Editor settings page with "Show exact save time"; the exact time is always
  available on hover over any note's date. `format.test.ts` covers the
  formatting (9 tests)
- Each note now loads with its own clean editing state, so a stray caret no
  longer lingers when switching notes and undo no longer reaches back into the
  previously open note
- Links set to open with Cmd/Ctrl+Click show the pointer cursor while the
  modifier is held. `links.test.ts` (16 tests)

## Remaining to done

- **The caret/undo isolation fix has no regression test.** The `undo` coverage
  in `library.svelte.test.ts` is workspace-delete undo, and the `caret` coverage
  in `kernel.test.ts` is fold behavior. Neither exercises per-note editor state
- `SettingsEditor.svelte` (57 lines) is untested, though it is one toggle

## Non-goals

- No further editor preferences beyond the shipped toggle
- No changes to the fold/preview kernel

## Sequencing

Smallest of the four 0.9.0 units. Depends on the settings primitives frozen in
`feat-settings-dashboard`.

## Impact

The state-isolation fix protects the "Trust is release" promise directly: undo
reaching into a previous note is a way to lose writing that the user believed
was parked.
