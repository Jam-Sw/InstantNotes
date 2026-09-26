# Tasks: An Update Is a Notification, Not a Modal

View-only: it renders the updater's state and stores nothing, so the SEQUENCE
insertion rule places it in any slot between units. Landed on `0.9.0-pre` on
2026-09-24.

## Decide first

- [x] Delta source. **True delta from the GitHub release assets** (decided
      2026-09-24). The updater plugin only reports a size once a download
      starts, so the running and offered updater artifacts are read from
      `api.github.com` and compared. Any failure shows no delta.
- [x] Manual-check outcome. **A toast** (decided 2026-09-24): "up to date" and
      failures surface without the modal.
- [x] Release notes. **The second note in the Space** (decided 2026-09-24),
      opened in the ordinary editor. Not a bespoke read-only panel.
- [x] The Space is **synthetic** (decided 2026-09-24): it never becomes user
      data, so it cannot reach the vault and needs no cleanup.
- [x] `Ok` **only dismisses** (decided 2026-09-24); the installed update applies
      on the next launch.

## Build

- [x] `src/lib/update/space.ts`: ids, the two note titles, the notes builder,
      and the delta line, all pure
- [x] `src/lib/update/release-size.ts`: pick the platform's updater artifact by
      name, read both releases' sizes, and diff them; every failure is null
- [x] Updater store: `date`, `sizeDelta`/`deltaState` with a best-effort load,
      `pendingUpdate`, `acknowledge`, and the manual-check toasts
- [x] Remove the modal (`UpdatePanel.svelte`) and the now-unused snooze path
      (`updater-snooze.ts`)
- [x] Library store: the update Space is not queried, `selectVirtual` opens a
      synthetic note, and a synthetic body edit never queues a write
- [x] `SidebarEntityRow`: an optional trailing `suffix` snippet and a `readonly`
      variant (no rename, no context menu)
- [x] Sidebar: the `Update *` row, first under Spaces
- [x] NoteList: the Space's two rows, routed through `selectVirtual`
- [x] `UpdateNote.svelte`: versions, delta, Update -> progress -> Ok, reusing the
      old modal's primary button, not a new one
- [x] NoteEditor: a synthetic note opens read-only outside the body
- [x] `+page.svelte`: delete the panel wiring, open the Space from the tray and
      the pill, and leave the Space when it goes away
- [x] Tests: the pure helpers, the store transitions, and the note component
- [x] Docs: `CHANGELOG.md`, `spec.md`, and this change archived
