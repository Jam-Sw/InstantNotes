# Spaces Design (Workspace Management Rework)

**Date:** 2026-07-10
**Branch target:** `feat/spaces`
**Status:** Approved - pending implementation plan
**Interactive demo:** https://claude.ai/code/artifact/0b62b62a-1682-440f-a16d-e464b9197686 (Direction 2.1)

---

## Concept

A **space** is an intentional place you go to work on one thing. A **tag** is emergent: it is born at capture time ("fix xyz bug #bug", hotkey, done) and closes the open loop with zero ceremony. Both stay one-click destinations in the sidebar.

The razor: if you would go there to add something, it is a space. If you would look for it across places, it is a tag.

Consequences of the definition:

- Empty spaces are legitimate (intent before content) and always stay visible. Tags with zero uses stay hidden, as today.
- Deleting a space never touches notes, so deletion is routine and low-stakes: immediate, with Undo, no confirm dialog.
- Rename is a routine verb and must be reachable.
- At the graph and local-AI stages, a space is the natural context boundary (subgraph, retrieval scope). Nothing in this design needs undoing then.

**Vocabulary:** the UI says "Space / Spaces" everywhere. The backend, schema, and command names keep the `workspace` naming (`note_workspaces`, `rename_workspace`, and so on). Renaming storage internals is churn with zero user value.

---

## Summary

1. Space rows adopt the exact Tags interaction contract: no resting chrome, context menu (Rename / Delete), double-click inline rename. The hover-reveal delete button is removed.
2. Delete becomes immediate + undo toast, replacing the confirm dialog. Undo restores the space and its memberships.
3. Inside a space, the note list header gains tag chips scoped to that space's own tags. Tapping one filters within the space. This is the new capability: one "To do" space sliced by #school / #car / #errand instead of parallel todo spaces.
4. UI wording sweep from "workspace" to "space".

---

## Interaction design

| Action | Behavior |
|---|---|
| Switch | Click a row. Click the active row again to return to All Notes (unchanged). |
| Create | The quiet "New space..." input at the bottom of the section (unchanged position). Enter commits; an existing name switches to that space (current `getOrCreateWorkspace` behavior). |
| Rename | Double-click the row, or context menu > Rename Space. Enter commits, Escape cancels, blur cancels. Empty or duplicate names keep edit mode and show the inline error + shake, exactly like `TagRow`. Backed by the already-tested `rename_workspace` (duplicate guard exists). |
| Delete | Context menu > Delete Space (danger item). Immediate. Toast: `Deleted "Movies" - notes are kept` with an Undo action. No confirm dialog. |
| Context menu | Right-click or Shift+F10, via the existing `ContextMenu.svelte`. Items: Rename Space, Delete Space. |

### Scoped tag chips

- Shown only when a space is active, and only for tags present on that space's notes. No chips in All Notes (the rail already covers global tag access) and none when the space has no tagged notes.
- Tap toggles the filter within the space; the note count in the header reflects the filtered list.
- Entering or leaving a space, or switching spaces, clears the scoped tag.
- Rail tags keep today's semantics: global, one click, exclusive with spaces.

---

## Store changes (`library.svelte.ts`)

| Change | Detail |
|---|---|
| New state `scopedTagId` | Composes with `activeWorkspaceId`: `#filter()` sets both `workspaceId` and `tagIds` when a space and a scoped tag are active. `selectWorkspace()` resets it. Global `setTagFilter()` keeps its current semantics (clears the workspace). |
| `removeWorkspace()` | Snapshot the space's member note ids, delete, then `toasts.show` with an Undo action. Undo recreates the space by name and re-adds memberships, mirroring `#undoSoftDelete` (failures land in a plain toast, never throw into the toast handler). |
| Rename path | New `renameWorkspace()` following the Sidebar `renameTag` shape: call the client, refresh, map `ApiError` to an inline `{ ok, message }` result. |
| Active-space rename | `workspaces:changed` already refreshes the list; the implementation must also refresh `selectedWorkspaces` when a note is open so editor membership chips pick up the new name. |
| Delete active space | Lands in All Notes (`refreshWorkspaces` already handles the space disappearing; keep the explicit reset in `removeWorkspace` too). |

---

## Backend

- `rename_workspace` exists and is unit-tested (Rust + TS client, duplicate-name guard). This design finally wires it to the UI.
- **Undo fidelity item (verify during implementation):** the membership snapshot must include archived and trashed member notes. If `list_notes({ workspaceId })` excludes them by default, extend `delete_workspace` to return the member note ids (Rust + TS client + tests) instead of snapshotting client-side.
- Undo recreates the space via `get_or_create_workspace`, so it gets a new id. Acceptable: nothing persists space ids across sessions, and the active selection was already reset.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/components/SpaceRow.svelte` | **New.** Sibling of `TagRow.svelte` with the same contract (select, dblclick rename, inline error, context menu hook). A light sibling, not a premature abstraction over two consumers. |
| `src/lib/components/Sidebar.svelte` | Space rows via `SpaceRow`; remove hover-x markup and CSS; remove the confirm-dialog delete path; menu state for spaces; wording. |
| `src/lib/components/NoteList.svelte` | Scoped tag chip row below the toolbar when a space is active. The status-filter pills already hide there (`NoteList.svelte:46`), so the chips take that slot rather than adding a new band. Also the "No notes in this workspace yet" empty-state wording. |
| `src/lib/stores/library.svelte.ts` | `scopedTagId`, `renameWorkspace()`, undo-delete `removeWorkspace()`. |
| `src/lib/components/NoteEditor.svelte` | Wording: "Add to space...", membership chip labels. |
| `src-tauri/src/lib.rs` | Only if the undo fidelity item requires `delete_workspace` to return member ids. |
| Command palette / misc strings | Sweep any "workspace" UI strings found in `commands.ts`, `palette-sections.ts`, hints, tooltips. |

---

## Testing

- Store tests: undo restores memberships (including archived/trashed members), delete of the active space resets to All Notes, scoped tag composes with the space filter and clears on space switch.
- Component behavior: rename commit / cancel / duplicate error parity with `TagRow`; menu opens via right-click and Shift+F10.
- Rust tests only if `delete_workspace` changes shape.
- Existing `rename_workspace` tests already cover the duplicate guard.

---

## Out of scope

- Reordering spaces, bulk operations, a manage modal, an Unfiled view (revisit at the graph stage).
- Any schema or backend renaming from `workspace` to `space`.
- Per-note membership UI in the editor (unchanged apart from wording).
