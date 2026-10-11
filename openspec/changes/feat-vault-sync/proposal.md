# Change: Vault Sync

## Why

The vault mirror writes every note to a folder, but nothing reads that folder
back. Two devices pointed at one folder overwrite each other: each writes its
own notes and never sees the other's, and the last device to write
`instantnotes.yaml` erases the other's tags and Spaces.

The maintainer runs a home server with a network drive. Pointing every device
at a folder on that drive is the whole sync setup, as long as the app reads
the folder as well as writing it. This change adds the reading half.

That makes this the sync foundation, not a feature for one setup. A shared
network folder is the first way to sync. Syncthing, Dropbox, and git (stage 4
of `feat-portable-vault-sync`) are later ones. All of them use the same folder
format and the same reconcile engine, and differ only in how changes reach
the folder. This change builds the engine, plus a seam (`Transport`) that each
later sync method plugs into.

## What Changes

- **Reconcile engine** (`core/src/vault/reconcile.rs`, `store/vault_sync.rs`):
  reads the folder back into the library.
  - It decides per note between the folder's copy and the library's, using
    the hash recorded at the last sync as the common base.
  - Notes are inserted, updated, moved, trashed, and restored from the files.
  - An edit made on two devices before either synced becomes a conflict copy,
    so no edit is lost.
- **Manifest merge**: `instantnotes.yaml` is merged key by key against the
  last version this device synced, not overwritten.
- **Flush guard**: the mirror no longer overwrites a note file that changed
  in the folder since this device last wrote it. That change is read in first.
- **Vault marker**: a folder counts as the vault only while it holds
  `instantnotes.yaml`. An unmounted network share often leaves an empty mount
  point behind. The marker keeps the app from reading that as "every note was
  deleted", and from writing notes onto the local disk underneath it.
- **Removal guard**: a cycle that would trash more than half the library
  (above 20 notes) is held until the user confirms it.
- **`Transport` seam** (`core/src/vault/transport.rs`), with one
  implementation, `Folder`.
  - A transport moves changes between the vault folder and wherever they
    live: before a cycle reads the folder (`pull`) and after it writes
    (`push`).
  - It also reports whether the vault is reachable, and how often to look.
  - `Folder` is a folder the OS already shares: a network drive, or a
    Syncthing or Dropbox folder.
- **`Syncer`** (`core/src/vault/sync.rs`) runs one sync cycle (pull, scan,
  reconcile, flush, push) against `Mutex<Store>`. The desktop shell's
  background writer becomes the loop that drives it: a local change triggers
  a cycle after a short quiet period, and with no changes the folder is
  polled every 5 s. Network filesystems do not deliver change events, so
  polling is the only detection that works on all of them.
- **Attachments** are copied both ways between the vault and the app's
  attachments folder.
- **Status and events**:
  - Settings > Vault shows whether the folder is reachable, when it last
    synced, notes waiting to sync, conflicts, and held removals.
  - A new event, `vault:synced`, carries the ids of notes changed from the
    folder, so an open note shows the other device's edit.

## Non-goals

- No sync server and no protocol: the folder is the protocol.
- No automatic merge of note bodies; a conflict becomes a copy.
- No rebuild of a lost database from the vault. A new device that joins
  ingests the whole folder, which covers the same ground for sync.
  Corruption recovery stays in stage 3 of `feat-portable-vault-sync`.
- No git transport (stage 4), no file watcher (polling serves every
  transport), no encryption.
- `last_opened_at` stays device-local, as `feat-portable-vault-sync` §7.2
  decided.

## Impact

- No migration. The only new persisted state is one settings key
  (`vault.manifestBase`): the manifest this device last synced, which is the
  base of the next merge.
- Note shape is unchanged.
- IPC:
  - `get_vault_status` and `set_vault_folder` return more fields.
  - New command: `confirm_vault_removals`.
  - New event: `vault:synced`.

Design: `design.md`.
