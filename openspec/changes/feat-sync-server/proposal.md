# Change: Sync Server

## Why

One person writes in InstantNotes on more than one device: a Linux desktop,
a Mac, a computer's browser, a phone. Today those are separate libraries,
unless every device can mount one shared folder (0.10, `feat-vault-sync`),
and a phone browser cannot mount anything.

InstantNotes already ships a server, `instantnotes-server` (0.9.5), that
anyone can run. This change makes it a sync server: every device keeps its
full library, works offline, and meets the others through the server the
person chose to run. Notes are encrypted on the device, so the server, its
operator and its backups hold nothing readable. To anyone reading the feature
list it is ordinary: "InstantNotes supports self-hosted, end-to-end encrypted
sync". Setting it up is the same for every self-hoster; nothing in the app,
the image or the docs knows any particular person's server.

It builds on `feat-vault-sync`: the note format, the reconcile rules, the
keep-both conflict rule, the manifest merge and the removal guard are reused
as they are. What changes is how a note travels: as an encrypted object keyed
by its id, because a browser and a phone have no shared folder. The Folder
provider is unchanged.

## What Changes

- **Settings > Sync** replaces Settings > Vault: **Off** (default),
  **Folder** (0.10) or **Sync server**. **Git** keeps its slot in the setting's
  values but is not offered until it exists. Sync server asks for the server's
  address; signing in follows in the system browser.
- **End-to-end encryption, a switch that is on by default.** Every note, tag,
  Space and image is encrypted on the device with age (X25519,
  ChaCha20-Poly1305) before it leaves; object names on the server are random.
  No passphrase. Turned off, the server can read the notes, and a new device
  needs only to sign in. Flipping it rewrites the library on the server as one
  switch-over.
- **Keys without chores.** The first device makes the key and shows a recovery
  key to save. Each further device or browser is approved from one already in
  use, by checking six words. The recovery key is needed only if every
  device is lost.
- **One engine everywhere.** The Rust core runs natively on the desktop and,
  compiled to WebAssembly, in the browser on a computer or phone, with its own
  local copy, offline editing, and the same UI. The design leaves room for a
  native iOS app through Tauri later.
- **The server**: sign-in, a per-person store of encrypted objects with a
  numbered change log, the relay for approving new devices, and the web app's
  files. 0.9.5's server-side library is replaced; existing web libraries are
  moved into the encrypted library by the person's first device.
- **Desktop sign-in** through the system browser with a loopback callback
  (RFC 8252, PKCE); the device token and the key live in the system keychain.
  The identity provider needs one callback URL, the one 0.9.5 already uses.
- **Token checks fixed**: id_token signature against the provider's JWKS,
  plus issuer, audience, `azp`, expiry, issued-at, not-before and nonce. 0.9.5
  decoded the claims without checking the signature.
- **Joining libraries**: a device with notes asks before combining with a
  server that has notes, backs up, then merges without loss. Exact copies are
  combined automatically and undoably; anything uncertain is kept twice and
  listed in a "Review merge" Space, side by side, with Keep both, Keep this
  one, Keep that one. Sync never waits for the review.
- **Hardening**: HTTPS only, rate limits, hashed tokens and sessions that
  survive a restart, devices listed and revocable in Settings.
- **A person the identity provider stops accepting stops syncing within a
  day**: the server keeps each person's refresh token, encrypted, refreshes it
  hourly, and revokes all of that person's devices and sessions when the
  provider refuses; an unreachable provider is retried, never treated as a
  refusal. Stored data is untouched.
- **Self-hosting docs**: the image, the data folder, the sign-in settings, the
  address and the health check, and what an operator can and cannot see.

## Non-goals

- A native phone app (the design leaves its slot: §5.1, §15).
- Merging two edits of one note into one text; a conflict keeps both, as 0.10.
- Git sync (paused), server-side version history, sharing a library between
  people, server-side search.
- Changing the library key after revoking a device, and post-quantum keys
  (design §4.6, §11).
- Passkey unlock in browsers (decision D7).

## Impact

- **Store**: one new table, `sync_objects`, by migration; no note column
  changes. New settings keys: `vault.transport = "server"` and `vault.server`
  (address, device id, display name, cursor, `libraryId`). The device token and
  library key live in the system keychain, never in the library.
- **Core**: the deciding half of 0.10's ingest is split from its file reading
  so it runs on bytes from the server; a new `ServerSync` beside `Syncer`. The
  core gains two target-only features to build for WebAssembly.
- **New crate** `src-tauri/web` (the browser build of the core).
- **Server**: `/api/<command>` and the per-person `Store` removed; `/sync/v1`
  added; `server.db`, `sync/<person>/`. `INSTANTNOTES_VAULT_ROOT` (0.10,
  unreleased) removed. New optional `INSTANTNOTES_TRUST_PROXY`,
  `INSTANTNOTES_MAX_OBJECT_MB`.
- **IPC**: `connect_sync_server`, `disconnect_sync_server`,
  `approve_sync_device`, `deny_sync_device`, `list_sync_devices`,
  `revoke_sync_device`, `show_recovery_key`; events `sync:signed-out`,
  `sync:join-request`; `get_vault_status` gains the server fields.
- **Dependencies**: `age` (and its RustCrypto and dalek crates),
  `jsonwebtoken`, `keyring`, `governor`, reqwest `blocking`, `wasm-bindgen`,
  `sqlite-wasm-rs` with its OPFS storage, a QR encoder, `similar` (text
  likeness for the merge, checked to build for WebAssembly) and
  `@codemirror/merge` (the side-by-side review).
- **Fixed on the way**: four places in 0.10.0-pre name the maintainer's
  server or tailnet (`SEQUENCE.md`, `feat-vault-sync/tasks.md`, two test
  fixtures); they get generic names.

## Placement

`SEQUENCE.md`'s insertion rule puts new persisted state after unit 9, which is
not built. This change adds one table and settings keys and changes no note
shape; it is recorded as an exception by the owner's decision, like units 7, 8
and 13d to 13i. Branch `feat/sync-server`, cut from `0.10.0-pre` and merged
back into it when done: it ships in 0.10.0 with folder sync (D5).

## Decisions for the owner

`design.md` §14, all decided on 2026-10-12: D1 (encryption ships now,
everywhere), D6 (a switch, on by default), D2 (desktop sign-in through the
server), D4 (joining: automate only what is certain, the rest reviewed), D5
(folded into 0.10.0). D3 and D7 are recorded with no real alternative left.

Design: `design.md`. Tasks: `tasks.md`.
