# Design: Vault Sync

The vault format, file names, and the stage 2 flush come from
`feat-portable-vault-sync/design.md`. This document covers how the vault is
read back in, and the contract every sync method builds on.

## 1. Model

Each device keeps its own SQLite database, which is the library the app
reads. Devices share one thing: the vault folder. Every device makes its
library agree with the folder, and every write goes through the folder.

```
device A  <->  vault folder  <->  device B
(SQLite)     (Markdown files)     (SQLite)
```

Nothing ever compares two databases with each other. Each device compares
only its own database with the folder. Adding a sync method therefore never
touches the merge rules: it only changes how files reach the folder.

## 2. The cycle

`Syncer::cycle` runs these steps in order, every time:

| Step | Store lock | What it does |
| --- | --- | --- |
| `pull` | no | The transport brings remote changes into the folder and reports whether the vault is reachable. |
| scan | no | List the folder and take a stamp (size, mtime) of each file. |
| ingest | yes, 50 files per hold | Read each changed file and reconcile it with its note (§4). |
| removals | yes | Handle notes whose file is gone (§5). |
| flush | yes, 50 notes per hold | Write notes changed here (stage 2), with the guard in §7, then merge `instantnotes.yaml` (§6). |
| attachments | no | Copy images each side lacks, in both directions. |
| `push` | no | The transport sends the folder's changes on. |

When `pull` reports the vault unreachable, the cycle stops right there.
Edits made here keep their `vault_dirty` flag. That flag is the offline
queue: there is no second queue, and a crash loses nothing.

Ingest runs before flush, so a note edited on two devices is always seen as
a conflict before either version is written.

A file is read under the store lock on purpose. The flush also holds the
lock while it writes and records a hash. Reading under the same lock means
ingest can never mistake this device's own write, landing between the scan
and the read, for another device's edit, and undo it.

### 2.1 Change detection

A file is a candidate in a cycle when its stamp differs from the stamp the
`Syncer` recorded the last time it handled that path. A stamp is recorded
only once its mtime is more than 2 s older than the newest mtime in the
listing.

The 2 s rule covers mtime granularity. Some filesystems keep 1 s mtimes, so
two writes within one second, with the same size, leave the same stamp. A
file that new is read again on every cycle until it settles. The rule
compares mtimes with each other, never with this device's clock, so clock
skew between devices cannot defeat it.

A candidate whose bytes still hash to the note's `file_sha` costs one read
and changes nothing. That is the echo of this device's own write.

Stamps live in memory. A restart reads every file once.

## 3. The vault marker

The folder is the vault only while `instantnotes.yaml` exists in it. Without
the file, `pull` reports the vault unreachable, and the flush refuses to
write.

- Choosing a folder in Settings creates the file if it is missing. That is
  the only place the app creates it.
- The marker exists because of network shares. An unmounted share often
  leaves its mount point behind as an empty local directory. Without the
  marker, the app would read that empty directory as "every note was
  deleted", and would write notes onto the local disk underneath the mount.
- The stage 2 rule, "the vault root is never created", is not enough on its
  own here, because the mount point already exists.

## 4. Reconciling one file

The store reads the note file and the surface file beside it, if there is
one, and hashes both. Call the result *remote*. *local* is the note with
that id in the database, as `vault_note` renders it. The note's `file_sha`
and `board_sha` are the base: the bytes this device last wrote or read at
that path.

Rules, in order:

| # | Condition | Decision |
| --- | --- | --- |
| 1 | No note has this id, and the path is tombstoned with these bytes | Skip: a local destroy is waiting to remove this file. |
| 2 | No note has this id | Insert it. |
| 3 | Bytes equal the base | Unchanged. If the path differs from `vault_path`, record the move. |
| 4 | remote and local are equivalent (§4.2) | Record the base. Clean. |
| 5 | Base known, local clean | Take remote. |
| 6 | Base known, local dirty | Conflict: keep local, copy remote. |
| 7 | No base, local clean, remote not older | Take remote. |
| 8 | No base, otherwise | Conflict: the newer `updated` keeps the note, the other becomes the copy (ties keep local). |

`decide` in `vault/reconcile.rs` is this table as a pure function. Every
row has a test there.

### 4.1 Where state comes from

Location decides trash: a file under `trash/` is a trashed note, and a file
anywhere else is not, whatever its `deleted` key says. The frontmatter
`deleted` gives only the time; a file moved into `trash/` by hand without
one takes the time of the cycle that read it.

Tags come from the `tags` list plus every `#tag` in the body. A tag whose
token appears in the body is `inline`; any other is `manual`.

Surfaces:
- A whiteboard's canvas is read from its `.excalidraw` file. A whiteboard
  with no such file is an empty scene.
- A sheet's grid is read from its `.csv` file. It keeps this device's column
  widths and row count, and its body is derived from the grid, as for every
  sheet save.

A note inserted from the vault gets `last_opened_at = updated`, so a device
joining a vault does not fill Revisit with every old note. Revisit stays
about what was captured on this device (§7.2 of the vault design).

After a file is applied, the note is rendered again. If that rendering is
not equivalent to the file (the file had no `id`, a body tag was missing
from the list, a trashed file had no `deleted`), the note is marked dirty,
so the flush rewrites the file in canonical form.

### 4.2 Equivalent

Two versions are equivalent when they hold the same note. `created` and
`updated` are ignored, so a pure timestamp difference never makes a
conflict copy.

| Field | Compared as |
| --- | --- |
| title | as written |
| body | as written |
| flags (pinned, archived) | as written |
| trash state | trashed or not |
| kind | as written |
| tags | normalized, as a set |
| Spaces | case-insensitive, as a set |
| surface | `same_surface` |

### 4.3 Conflict copies

The losing version becomes a new note:

- **Title:** `<title> (conflict <YYYY-MM-DD HH:MM>)`.
- **Tag:** `conflict` (manual).
- **Content:** the losing version's content and Spaces.
- **Id:** derived from the original id and the losing bytes. So two devices
  that resolve the same conflict create one copy, not two, and a repeated
  cycle is a no-op.

The copy is dirty, and the flush writes it to the folder like any new note.
The status counts conflicts since launch.

### 4.4 Files that are not notes, or not yet

- **A Markdown file with no frontmatter**, at a path no note claims, is
  adopted:
  - Its id is derived from its path and bytes.
  - Its title is the file name, and its times are the file's mtime.
  - It is marked dirty, so the flush writes the id back into it.
  - Deriving the id means two devices that adopt the same file in the same
    moment adopt the same note, not two copies of it.
- **A file that fails to parse at a path a note owns** is reported and left
  alone. A broken edit to a note's frontmatter must not turn the note into
  a second note.
- **Two files carrying one id:** the one at the note's `vault_path` is the
  note, while that file exists. Any other is a copy (Syncthing writes those
  as `*.sync-conflict-*`, and a user can duplicate a file by hand). The copy
  is inserted with an id derived from the original id and its path, and the
  flush rewrites it with its new id.

## 5. Removals

A note whose `vault_path` no longer appears in the listing is checked again
under the lock.

- If its file is still missing and the note is clean, it is trashed here.
  Its path and hashes are cleared, and it stays clean, so the next flush
  does not put its file back.
- If it was already in the trash, only its path is forgotten.
- A dirty note is left alone. Its edit wins over the removal, and the flush
  writes its file again.

A destroy on one device therefore trashes the note on the others, and never
destroys it there. Emptying the trash stays a decision each device makes on
its own.

**Removal guard.** A cycle that would trash more than half the notes the
vault knows, and more than 20, removes nothing. It reports the count instead
(`heldRemovals`). The cycle holds again on every pass until the files come
back or the user confirms in Settings (`confirm_vault_removals`). The
confirmation lets the next cycle through, once.

## 6. `instantnotes.yaml`

The manifest is merged three ways. The base is the manifest text this device
last wrote or read, stored as `vault.manifestBase`, which is device-local
like every setting. Tags are keyed by name, and Spaces by case-folded name.
Each key, alone:

| Here | Folder | Base | Result |
| --- | --- | --- | --- |
| has | has | any | kept; color: the folder's if ours equals the base's, else ours |
| has | missing | had it | removed remotely: delete here if no note uses it |
| has | missing | missing | added here: kept |
| missing | has | had it | removed here: dropped |
| missing | has | missing | added remotely: created here |

With no base (a device's first cycle), nothing is removed, so a joining
device and the folder take the union.

A folder manifest that fails to parse is reported, and the folder file is
left alone; nothing is merged or written.

The merged manifest is rendered from the store and written when its bytes
differ from the folder's. Base and write happen in the same lock hold as the
merge. The merge is the flush's last step, so a color change made here
reaches the folder through the next flush, as in stage 2.

## 7. The flush guard

Stage 2 overwrote a note's own file unconditionally. Now:

- The note's own file is overwritten only while it still holds the bytes
  this device last wrote or read there (`file_sha`, and `board_sha` for its
  surface file). If those bytes have changed, the note is left dirty and
  counted as deferred, not as an error. The next cycle's ingest decides it
  under §4.
- A file at a new name that carries the note's id but has no recorded base
  (stage 2 adopted these in place) is no longer adopted by the flush. Ingest
  sees it first (rule 4 or 8). An earlier export of the same library is
  equivalent, and is adopted silently.

## 8. Transports

```rust
pub trait Transport: Send {
    fn name(&self) -> &'static str;
    fn root(&self) -> &Path;
    fn interval(&self) -> Duration;
    fn pull(&mut self) -> Reach;
    fn push(&mut self) -> Reach;
}
```

The contract every implementation keeps:

- `root` is a folder on this device's filesystem. The engine reads and
  writes only there. A transport whose remote is not a filesystem (git,
  WebDAV, a server) keeps a local working folder and moves files between
  that folder and the remote in `pull` and `push`.
- `pull` returns `Reach::Ready` only when `root` holds the vault marker and
  remote changes are in `root`.
- `push` runs only after a cycle that reached the folder. It may fail; the
  files stay in `root` and the next `push` retries.
- A transport never parses or merges notes. Conflicts its own tooling
  produces (a git merge, Syncthing's conflict files) are left as files, and
  §4.4 turns them into conflict copies.
- `interval` is how often the shell starts a cycle with no local change.

| Transport | `root` | `pull` / `push` | `interval` | Status |
| --- | --- | --- | --- | --- |
| `Folder` | the shared folder itself | reachability check only | 5 s | this change |
| git | a local clone | `fetch` + rebase / commit + push | about 60 s | stage 4 |
| server or WebDAV | a local mirror folder | download / upload changed files | per the remote | not planned |

The setting `vault.transport` names the transport and defaults to `folder`,
so existing mirrors keep working unchanged. `transport::open` maps the name
to an implementation.

## 9. Shell

In `shell/mirror.rs`, a thread that owns the `Syncer` replaces the stage 2
flusher.

- **Local writes.** Every write command still pokes the thread. It waits for
  300 ms of quiet, at most 2 s, then runs a cycle.
- **No writes.** The thread wakes every `interval` and runs a cycle.
- **Folder changes.** Before each cycle, the thread compares the store's
  vault root with the `Syncer`'s, and builds a new `Syncer` when the root
  changed or was turned off.

After a cycle, the thread emits:

- `notes:changed` when notes changed;
- `vault:synced` with their ids;
- `tags:changed` and `workspaces:changed` when the manifest or ingest touched
  tags or Spaces;
- `vault:status`, always.

The thread emits these directly, not through the `emit_*_changed` helpers,
because the helpers would poke the thread into a cycle over its own changes.

The library treats `vault:synced` the way it treats an agent's write. With
nothing unsaved, the open note takes the new version. With unsaved typing,
the save meets the other version through the version check, and the user
can restore theirs.

Quit runs one flush chunk, as before. Ingest is not run at quit.

## 10. Rejected

- **A `notify` watcher.** Neither SMB nor NFS delivers inotify events, and
  network drives are the first transport. Polling stamps works everywhere
  and costs one directory listing per cycle. A watcher can later start a
  cycle sooner on local folders. It does not replace the scan.
- **Last-write-wins on `updated`.** It discards an edit whenever two devices
  edited the same note. Rule 8 uses `updated` only when there is no base,
  and even then keeps the loser as a copy.
- **The database on the share.** WAL does not work over SMB or NFS, and
  `Store::open` refuses it (vault design D4).
- **A persisted stamp table.** It would be a migration for an optimization.
  It costs one full read per launch, over a folder that is mostly small text
  files.
- **Destroying a note when its file disappears.** The trash is the only
  undo the user has. A destroy is propagated as a trash.
