# Change: Keep the action label readable for long note titles in the palette

## Why
Note-scoped commands in the command palette render the note title as a breadcrumb
prefix before the action label, for example "My very long note title > Pin note".
The title and the action shared a single ellipsized line, so a long title consumed
the whole row and pushed the action label out of view. The user could no longer tell
which action a row would run.

## What Changes
- Render the palette title region as a flex row so the action label keeps its width.
- Give the note-title and folder prefix its own max-width and ellipsis, so a long
  title truncates on its own while the separator and action stay fully visible.
- Keep the breadcrumb separator, the leading icon, and the action label from shrinking.

## Impact
A presentational change confined to `src/lib/components/CommandPalette.svelte` (one
markup wrap plus CSS). No command logic, store, or Rust changes. The folder breadcrumb
shown on searched leaves benefits from the same prefix cap.
