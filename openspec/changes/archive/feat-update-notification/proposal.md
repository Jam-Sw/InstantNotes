# Change: An Update Is a Notification, Not a Modal

## Why

The update flow was a modal reached from a pill on the empty library state.
A modal interrupts and reads as a system event; an available update is not an
emergency, it is an invitation. The library already has a place whose whole
vocabulary means "a thing you go and deal with": Spaces. An update can live
there without inventing any new surface, and without teaching the user a second
pattern for the same idea.

## What Changes

- An available update appears as the first row under Spaces, named `Update` with
  a green `*` on the end of the label. It looks and behaves like every other
  Space row - same size, same count, same hover - except it cannot be renamed,
  deleted, or right-clicked.
- Opening it lands in a Space of two notes:
  - `update <current> -> <new>`: the special note. Opening it shows the two
    versions, how much larger or smaller the download is, and the Update
    button. It is not editable and it is where the install lives: pressing
    Update shows progress in place, and when the install finishes the note
    offers `Ok`, which dismisses the notification.
  - `What's new in <new>`: the release notes from the changelog, as an ordinary
    note. It opens in the ordinary editor and can be typed in; nothing is saved,
    because it is not user data.
- The update Space is synthetic. Nothing is written to SQLite or the vault. It
  is derived from the updater's state, so it cannot be searched, tagged, filed,
  exported, backed up, or left behind, and it disappears the moment the update
  is gone.
- The size delta comes from the published release assets on GitHub: the running
  version's updater artifact against the offered one. It is best-effort; when
  either size is unknown the line is simply absent.
- A manual "Check for Updates…" reports "up to date" and failures with a toast,
  since there is no modal left to carry them.
- The welcome screen's update pill stays, as a shortcut into the update Space.

## Non-goals

- Turning an update into a real note or a real Space. That would leak into All
  Notes, search, the dashboard, the graph, and above all the vault mirror.
- A "remind me later" cadence. The notification is not a nag and carries no
  timer; it is ignored by doing nothing and answered by updating.
- Links between notes, or anything else the Space system does not already do.
