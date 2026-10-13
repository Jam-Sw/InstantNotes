# Design: Data safety

Three promises: the library is copied without anyone remembering to; the
copy can be put back from inside Settings; everything can leave as plain
Markdown on every device. SQLite stays the library; the vault folder is
unchanged.

## 1. What a backup is

A backup is a consistent snapshot of `instantnotes.db` made with
`VACUUM INTO`, which reads a transaction-consistent view including the WAL,
written to `<app data>/backups/instantnotes-<YYYYMMDD>-<HHMMSS>.db`. It is a
complete library: notes, tags, Spaces, settings, the sync bases, and in the
browser the images too. On the desktop the images live in
`<app data>/attachments/` as files; they are not copied into a backup (they
change only when a note is destroyed and the cleanup runs, and the Markdown
export carries them). The Backups page says so.

The snapshot is taken on a reader connection (`Store::open_reader`), so the
app does not pause while it runs. `backup_to` on a `query_only` connection is
proven by a core test, because that is the property the design rests on.

## 2. When

A background thread in the shell (`shell/backups.rs`) wakes 30 seconds after
launch and then every hour. With `backups.automatic` on (the default) it
backs up when the newest backup is older than 24 hours, then prunes. It
emits `backups:changed`. Back up now runs the same step at once. The browser
makes no automatic backups: its library is a replica of the server's and its
storage is small; the page says "Your notes are kept on the server and on
every signed-in device" and offers export.

## 3. The keep rule

`core::backup::keep(now, names) -> (kept, dropped)`, a pure function over the
timestamps in the file names:

- every backup from the last 7 days;
- for the 5 weeks before that, the newest of each ISO week;
- for the 6 months before that, the newest of each calendar month;
- nothing older; files whose names do not parse are never touched.

Manual backups follow the same rule (they are the same files). Pre-migration
snapshots (`instantnotes.db.backup-v<n>`, 0.9.x) are not in this folder and
are not pruned.

## 4. Restore (D6)

A restore never touches the open library. The flow:

1. The person picks a backup from the list, or a `.db` file from anywhere
   (Restore from a file). The shell verifies it: it opens read-only, passes
   `PRAGMA quick_check`, its `user_version` is at most this build's, and it
   holds a `notes` table. The dialog shows what it found: the date, the note
   count, and the warning that sync will be turned off (D6).
2. On confirm, the shell copies the file to `backups/pending-restore.db` and
   writes `instantnotes.db.restore` next to the library, holding that path.
   Then it restarts the app through the quit handshake, so every pending
   edit is flushed.
3. At the next launch, before the store opens, `Store::apply_pending_restore`
   reads the marker, snapshots the current library to
   `backups/instantnotes-<stamp>-before-restore.db` (through `VACUUM INTO`;
   if that fails because the current file is unreadable, the files are
   renamed aside with the same suffix instead, never deleted), removes the
   `-wal` and `-shm` files, moves the pending file into place, deletes the
   marker, and returns what it did.
4. The restored library opens normally (migrating if it is older), and
   `Store::detach_sync` runs: `configure_vault(None)`, `end_server_sync`,
   the `vault.transport` and `vault.server` keys deleted. The keychain
   entries of the old device registration are deleted too, so a later
   Sync server set-up is a fresh join. A dialog says: "Restored the library
   from <date>. Sync is off; turn it back on in Settings > Sync when ready."
5. A failure in step 3 leaves the current library as it was, deletes the
   marker so the app cannot loop, and shows the error.

The before-restore snapshot is a normal backup and follows the keep rule.

## 5. Export everything as Markdown

Desktop: `export_vault` to a chosen folder, as 0.10.0 (moved from the Sync
page to the Backups page, and a palette command). Browser: the core builds a
stored `.zip` (`vault::archive::write`: local headers, central directory,
CRC-32, UTF-8 names, no compression; a hand-written writer of about a hundred
lines, no dependency) holding the same files the folder export writes plus
`attachments/` from the database, and the page downloads
`InstantNotes-<YYYY-MM-DD>.zip`. The worker gains `export_archive()`.

## 6. Settings > Backups

Desktop: Automatic backups (toggle, daily), Back up now, the list (date,
size; Restore… on each), Restore from a file…, Open backups folder, and the
Export section. Web: titled Export, the server line and Export everything as
Markdown.

Palette: `data.backupNow`, `data.export`, `data.backups` (opens the page).

## 7. Commands and events

| Command | Purpose |
| --- | --- |
| `list_backups` | `[{ path, madeAt, bytes }]`, newest first; `automatic` and `lastAt` |
| `backup_now` | One backup, then prune; returns the list |
| `set_backups_automatic(on)` | The setting |
| `inspect_backup(path)` | `{ madeAt, notes, schemaVersion }` or `VALIDATION_ERROR` with the reason |
| `restore_backup(path)` | Steps 1 and 2 of §4, then `restart_app` |
| `open_backups_folder` | Reveal the folder |

Event `backups:changed` (no payload) after any backup or prune.

## 8. Tests

Core: `keep` over a crafted set of names spanning a year; `backup_to` on a
reader while a writer holds the store; `verify_backup` refuses a text file, a
newer schema, a database without `notes`; `apply_pending_restore` with a
marker (library replaced, before-restore snapshot present, marker gone,
`detach_sync` ran) and with a broken pending file (library untouched, marker
gone, error returned); `archive::write` round trip through a test reader
of the central directory, with the CRC-32 check value for "123456789".
Front end: the page per state; restore asks first and names the sync
consequence; export on the web triggers one download with the dated name.
In the app: back up, restore from the list, restore from a file, export on
the desktop and in the browser (`.claude/scripts/inapp-proof.sh` gains the
first two).
