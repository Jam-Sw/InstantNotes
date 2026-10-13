# Design: Sync Server

The note format, the reconcile rules, the keep-both conflict rule, the
manifest merge and the removal guard come from `feat-vault-sync/design.md`
(0.10). Its sections are written "vault §n" here. This document covers the
sync server, end-to-end encryption, sign-in, the browser and phone, and the
server's storage.

Revised on 2026-10-12 after the owner's answer to the first decision: end-to-end
encryption ships with this change, everywhere, and the design must leave room
for a native iOS app later. The research behind the choices is summarised in
§15.

## 1. Model

One notes engine, the Rust core, runs in every place a person writes:

```
desktop app (Linux, macOS, Windows)   core, native, SQLite on disk
browser (computer and phone)          the same core compiled to WebAssembly,
                                      SQLite in the browser's private storage
iOS app (later, not in this change)   the same core, native, through Tauri
```

Each of them keeps the person's full library, works with no connection, and
syncs through the person's server. The server never holds a key:

```
desktop  --\
browser  ----  ciphertext + sign-in  ---->  server: who you are, which
phone    --/                                devices you have, encrypted
                                            notes it cannot read
```

- **Notes are encrypted on the device** before they leave it, and decrypted
  only on a device of the same person.
- **The server stores and moves ciphertext**, keeps each person's encrypted
  notes apart, and relays one encrypted message when a new device joins.
- **The browser is a device** like the desktop. The server serves the app's
  code, and the code runs in the browser. 0.9.5's server-side library (the
  web mode that read and wrote notes on the server) is replaced; §8 moves
  existing web libraries over.

## 2. Providers and Settings

`vault.transport` (0.10) becomes the provider setting. Values: `folder` (0.10,
unchanged), `server` (this change), `git` (reserved: offered nowhere, refused
by `transport::open` with "not available in this version"). **Off** is no
provider, as in 0.10.

Settings > Vault becomes **Settings > Sync**:

```
Sync          [ Off | Folder | Sync server ]

Folder        0.10's card, unchanged

Sync server   not connected:  Server address [__________]  [Sign in…]
              signing in:     "Finish signing in in your browser."  [Cancel]
              joining:        "Approve this device on one you already use,
                               or enter your recovery key."  (§5.3)
              connected:      Server  notes.example.org
                              Signed in as  <name from the identity provider>
                              Status  Up to date / Syncing / Offline /
                                      Signed out / Held / Problem
                              Conflicts, held removals (as 0.10)
                              [Sign out]

Security      (Sync server)
              End-to-end encryption   [On]  (default; decision D6, §4.10)
                On:  "Your server stores your notes encrypted. Only your
                      devices can read them. New devices are approved from
                      one you already use; keep your recovery key safe."
                Off: "Your server can read your notes, and so can anyone with
                      its backups. New devices only need to sign in."
              Recovery key            [Show again]  (after the system's own
                                      unlock prompt, where there is one)
              Devices                 name, last seen, this device, [Revoke]
              [Sign out everywhere]

One-time copy Export a copy (unchanged; written in plain Markdown, on purpose)
```

- **Switching** asks first: "Stop syncing with <current>? Your notes stay on
  this device." Leaving Sync server revokes this device on the server and
  removes its token and key from the keychain. Joining Sync server is §8.
- **The browser** shows the same page without the provider choice: it is
  always on its server.
- Settings are per library: they live in the library's settings table.

## 3. Sync protocol

### 3.1 What moves: objects

Every synced thing is an **object** with a stable key:

| Key | Plain content | Notes |
| --- | --- | --- |
| `note:<id>` | the note's vault Markdown (vault `serialize_note`, with `deleted` set when trashed) and its surface text for a whiteboard or sheet, in one small JSON envelope | one object per note, for its whole life |
| `manifest` | `instantnotes.yaml` (tags and Spaces) | merged three ways as vault §6 |
| `attachment:<name>` | the image bytes | add-only, as 0.10's `copy_missing_files` |

Keying notes by id instead of by file name means a rename is an ordinary
update of one object, and trash is a field in it. Nothing on the server
depends on a title.

### 3.2 What the server stores

For each object, the server stores:

- its **name**, `HMAC-SHA256(name key, object key)` in hex, so the server sees
  random names (§4.2);
- its **content**, the age ciphertext of the plain content padded (§4.3);
- the SHA-256 of that ciphertext, its size, and the **sequence number** of the
  commit that last changed it. A deleted object keeps a row marked deleted
  (a tombstone).

Every accepted commit takes the next sequence number; the newest is the
store's **head**. Each store has a random `libraryId` from its creation.
Tombstones are never pruned (a few dozen bytes each), so no device is ever
"too far behind": a device that was offline for a year asks for everything
after its cursor, as on any other visit.

### 3.3 What a device keeps

New store table, `sync_objects(key, name, remote_sha)`: per object, its name on
the server and the ciphertext SHA this device last agreed with (the **remote
base**). The SHA of the plain content at that moment (the **plain base**) is
0.10's `notes.file_sha` for a note, `vault.manifestBase` for the manifest.
Plus settings: server address, device id, `libraryId`, epoch, cursor. The 0.10 `vault_dirty` flag
stays the offline queue, and the hard-delete trigger's tombstones stay the
record of destroyed notes. No note column changes.

### 3.4 One cycle

`ServerSync::cycle` runs against the same `StoreLock` as 0.10's `Syncer`, so
the desktop shell and the browser worker drive it the same way.

**Pull.** Ask for changes after the cursor, page after page until `more` is
false. For each changed object whose ciphertext SHA differs from the remote
base, download it, decrypt it, and decide:

| Object | Rule |
| --- | --- |
| `note:<id>` | 0.10's `decide` (vault §4), with the plain base as the base and `vault_dirty` as "local changed". Equivalent: record the bases. Local clean: take remote. Both changed: keep both; the newer keeps the note and the other becomes a copy titled "(conflict …)" and tagged `conflict` (vault §4.3). |
| `note:<id>` deleted | Destroyed elsewhere: trash it here unless dirty (vault §5). A dirty note wins and is sent again. The removal guard (vault §5) holds deletions above half the library and above 20. |
| `manifest` | `merge_manifest` (vault §6) with `vault.manifestBase` as the base. |
| `attachment:<name>` | Write it to the attachments folder if missing. |

The decisions reuse 0.10's code: `decide`, `equivalent`, `as_conflict`,
`derived_id`, `merge_manifest`, and the removal guard. Today these read the
note from a file in `ingest_vault_files`; the reading is split from the
deciding, so the same deciding runs on bytes that came from the server
(task 5.1). The Folder provider keeps reading files and is unchanged.

Downloads go 200 objects at a time. The cursor then moves to the head, except
when an object could not be applied (damaged, not decryptable with this
device's key, written by a newer app, or a failed save): the cursor stays below
the first such change, so it is fetched again on the next cycle, after an app
update, or once the right key is in place. While removals are held (§3.6), a
dirty note the server deleted still has its remote base cleared, so its own
push is not refused and does not hold back the other edits in its commit.

**Push.** For every dirty note and every destroyed note:

1. Render the note's plain content. If its SHA equals the plain base, clear
   the dirty flag and stop (an echo).
2. Encrypt, upload the ciphertext, and add `{ name, base: remote base, sha }`
   to the commit; for a destroyed note, `{ name, base, sha: null }`.
3. Add the merged manifest when it changed, and every attachment not yet on
   the server.
4. Commit. Accepted: record the bases, clear the dirty flags. Refused (409):
   another device committed one of these objects after this device's pull.
   Nothing is applied; the next cycle starts at once, its pull decides those
   objects by the table above, and its push commits on top.

Pushes go in batches of 500: each batch is uploaded and committed before the
next, so an interrupted first upload keeps what was committed and the next
cycle continues from there instead of sending everything again. The server
accepts at most 5,000 changes in one commit. An object larger than the server
accepts (§10) is skipped, named in the sync report and in Settings, and the
rest syncs.

### 3.5 Deletions, renames, trash

- **Rename**: an update of the note's object.
- **Trash and restore**: an update (the `deleted` field). Other devices move
  the note to or from the trash.
- **Destroy**: deletes the object. Other devices move the note to their trash,
  never destroy it (vault §5). Emptying the trash stays each device's choice.

### 3.6 Live changes

- Every device keeps one long-poll open (`changes?wait=25`) and starts a cycle
  when the head moves.
- Every local edit starts a cycle after 300 ms of quiet, at most 2 s (0.10).
- With no connection the device backs off (5 s, doubling to 5 min) and keeps
  working; its edits wait as dirty notes.

### 3.7 A server that went back in time

If `libraryId` changed, or the cursor is ahead of the head (`410`, a server
restored from an older backup, which keeps its `libraryId`), the device forgets
every remote base, the manifest base and its cursor, and pulls from the start.
Its plain bases remain, so every note equal on both sides is recognised, and
every difference is decided by keep-both. Every note, attachment and manifest
the pull did not bring back is then pushed again, so a new device or a browser
that lost its storage gets them from the server. Nothing is lost.

A page whose epoch is lower than the one this device knows, for the same
`libraryId`, is refused ("the server went back to an older form of this
library"): an older form could be a plain one this device must not write to.

## 4. End-to-end encryption

### 4.1 What it protects, and what it does not

Note text, titles, tags, Spaces, kinds and attachments are encrypted on the
device. The server, its operator, and anyone with its disk or backups see
only the metadata in §4.7. A browser's or a device's own local copy is not
encrypted by this feature: it is protected by the device (disk encryption,
the browser profile), as today.

### 4.2 Construction

- **Format: age v1** (C2SP spec with published test vectors). Every object is
  encrypted to the library's X25519 recipient: a fresh random file key per
  object, ChaCha20-Poly1305 in 64 KiB chunks, a header MAC.
- **One implementation everywhere**: the Rust `age` crate (0.12) on the desktop
  and, compiled to WebAssembly, in the browser (checked: it builds for
  `wasm32-unknown-unknown`). It is built on RustCrypto's `chacha20poly1305`
  (audited by NCC Group, 2020), `hkdf`, `hmac`, and dalek's `x25519-dalek`.
  The age crates themselves have no published audit; the format is small,
  public, and tested against its vectors in CI.
- **The library key** is one age X25519 identity, made on the first device
  that joins the server.
- **The name key** is `HKDF-SHA256(library key, "instantnotes object names")`;
  object names on the server are `HMAC-SHA256(name key, object key)`.
- **No passphrase.** There is no password to choose or remember for
  encryption: devices hand the key to each other (§5.3), and the recovery key
  covers losing them all (§4.5).
- No construction of our own: age is the composition, and the primitives are
  used as their maintained crates provide them.

### 4.3 Padding

Plain content is padded before encryption to the next multiple of 4 KiB up to
64 KiB, and to the next power of two above that, so sizes reveal only a rough
length.

### 4.4 Where the key lives

| Place | Where |
| --- | --- |
| Desktop | System keychain (`keyring`: macOS Keychain, Windows Credential Manager, Secret Service on Linux), beside the device token. No keychain answering: Sync server cannot start, and Settings says why. |
| Browser | IndexedDB, wrapped by a non-extractable WebCrypto AES-GCM key kept beside it. "Sign out of this browser" removes it with the browser's copy of the notes (§9), which serves a shared computer; there is no separate "remember" switch. A new key is written there (in a second slot) before the server is told about it, so an interrupted switch never leaves the only copy in memory. |
| iOS (later) | iOS Keychain through a small Swift plugin. |
| Server | Never. It stores the library's public recipient only, so a typed recovery key can be checked. |

### 4.5 Recovery

When the first device joins, the app makes the library key and shows the
**recovery key**: the age secret key, as text and as a QR code, with Copy,
Download and Print, and a required "I saved it somewhere safe" step. Before
that screen it says plainly: "If you lose this recovery key and every device
you use, your notes cannot be recovered by anyone, including whoever runs your
server."

The recovery key is only needed when no signed-in device is left. It also
decrypts any object with the standard `age` tool, without InstantNotes.

### 4.6 What end-to-end encryption rules out

- Anything the server would do by reading notes: server-side search, previews,
  a server-side web library (§1), the operator recovering a note.
- A device revoked after it held the key still holds it. Revoking stops it
  syncing; it does not make it forget what it already had. Changing the
  library key (re-encrypting everything and handing the new key to the
  remaining devices) is not part of this change.

### 4.7 What the server can still see

The person's identity (their identity provider's claims), their devices and
their IP addresses, when each device syncs, how many objects there are and
their padded sizes (roughly how many notes and images, and their rough
lengths), which objects change together and when, and the total stored.

### 4.8 The browser's code

In a browser, the code that holds the key is sent by the server. Whoever
controls the server, or the image it runs, could send code that reads the key.
No browser offers a deployable defence for this today (WEBCAT and WAICT are
experiments). For a self-hoster the operator is usually the person, so the
practical risks are a tampered image or a compromised server. Measures:

- The release publishes the image digest and the web app's file hashes;
  the README shows how to compare them.
- The desktop and iOS apps carry their own code and are not exposed to this.
- The README and Settings say it in one line: "The web app is code your server
  sends to your browser. For the strongest protection, use the desktop app."

### 4.9 Folder

The Folder provider stays plain Markdown on purpose: its promise is a folder
readable without the app. The same age layer could encrypt it later.

### 4.10 The switch (decision D6)

End-to-end encryption is a per-library switch, **on by default**.

**Off** stores each object's plain content, unpadded, under the name
`SHA-256("instantnotes:" + object key)`. Sign-in is the only step on a new
device (no §5.3, no recovery key), and a person who loses every device gets
their notes back by signing in. The server's operator and its backups can read
the notes. Everything else is the same: the browser still runs the core and
keeps its own copy.

**Flipping it** rewrites the library on the server, as one switch-over:

1. Objects carry an **epoch**; the server's `meta` holds the current epoch and
   its mode. The changes feed shows only the current epoch.
2. The device that flips it (any device already holding the notes, and the key
   when turning off) first pulls. If anything could not be read or sent, or if
   any live object of the old epoch is not among what it would upload (an
   attachment it does not hold, an object from a newer app), it refuses to
   switch and says why. Otherwise it uploads every object again in the new
   form under the next epoch, in as many commits as it takes. The first of
   those commits clears anything an earlier, abandoned attempt left in that
   epoch. Staging commits skip the base check. Other devices see none of it.
3. A final `switch` names the old epoch's head it was built from and how many
   live objects it staged. The server refuses it (`INCOMPLETE`) unless the
   staged count matches and is not short of the old epoch's live count (one
   less is allowed, the mode marker), so no device, with or without the key,
   can empty a library through a switch. If the old epoch moved meanwhile
   (another device edited), it is refused too; the flipping device pulls
   those edits, uploads them in the new form, and tries again, up to three
   times. Accepted: the new epoch becomes current, and the server deletes the
   old epoch's rows and the blobs only they used.
4. Turning on makes the library key and shows the recovery key first (§4.5),
   and sets the public recipient. Turning off deletes the recipient on the
   server, and each device deletes its copy of the key.
5. Every other device sees the epoch change on its next request. Turned on: it
   stops syncing and asks to be approved (§5.3) or for the recovery key; until
   then it keeps working locally, its edits waiting. Turned off: it carries on.
   Either way it then pulls the new epoch from the start; its plain bases mean
   unchanged notes are recognised, and edits made in between follow keep-both.

Turning encryption on does not reach server backups taken while it was off;
the confirmation says so.

**A server cannot turn encryption off on its own.** The server's word for the
mode is not trusted by a device that holds the key:

- Turning encryption off writes a marker object into the new epoch carrying
  `HMAC(proof key, "instantnotes plain" ‖ libraryId ‖ epoch)`, where the proof
  key is derived from the library key with HKDF. Only a device holding the key
  can make it.
- A device holding the key that sees the mode change to plain checks the
  marker before it uploads anything in plain form. It looks the marker up by
  name across every page of the feed, and accepts it only for an epoch newer
  than the one it knows, so a server that kept an older plain form of the
  library cannot serve it again. No marker, or a wrong one:
  it stops syncing and says "the server says encryption was turned off, but no
  device holding the key turned it off".
- A device holding the key that sees a different recipient than its own key
  refuses in the same way.
- A new device with no key that finds a plain library, while its own Settings
  say encryption on (the default), asks before uploading anything: "This
  server keeps notes unencrypted. Sync with it anyway?"

## 5. Sign-in and keys

Two separate things happen when a device joins: the server learns **who** the
person is (sign-in), and the device gets the **key** (§5.3). Sign-in never
gives the key; the key never travels unencrypted.

### 5.1 Desktop (and iOS later)

OAuth 2.0 for native apps (RFC 8252): system browser, PKCE. The server is the
authorization server for its devices and an OpenID Connect client of the
person's identity provider, as in 0.9.5 (decision D2).

1. The person types the address. The app adds `https://` when no scheme is
   given and refuses `http://` unless the host is `localhost`, `127.0.0.1` or
   `::1`. It calls `info`; anything that does not answer as an InstantNotes
   server stops here.
2. The app listens on `127.0.0.1` on a free port, makes `state` and a PKCE
   verifier, and opens the system browser at `device/authorize`.
3. The server accepts only `http://127.0.0.1:<port>/callback` or
   `http://[::1]:<port>/callback` as the redirect. (The iOS app will add
   `instantnotes://auth/callback`, opened through `ASWebAuthenticationSession`,
   which only the calling app receives.)
4. With no web session in that browser, the server runs its OIDC sign-in.
5. A confirm page: "Allow **<device name>** to sync your library as
   **<person>**?" Allow redirects to the loopback address with a one-time code
   (60 s, bound to the challenge and the redirect).
6. The app exchanges the code with its verifier for a device token and stores
   it in the keychain.

### 5.2 Browser and phone

The 0.9.5 sign-in: OIDC code flow with PKCE, an `HttpOnly`, `SameSite=Strict`,
`Secure` session cookie, 14 days sliding. Sessions become hashed rows in
`server.db`, so a server restart no longer signs everyone out. Each signed-in
browser is listed as a device. The web app gets a manifest and icons, so it
can sit on a phone's home screen, where it also keeps its local copy longest.

### 5.3 Getting the key onto a new device

With encryption off (§4.10) there is no key and this step is skipped. With it
on, a device with no key asks the server whether the library already has a key
(the server holds its public recipient):

- **No key yet**: this is the first device. It makes the library key and shows
  the recovery key (§4.5).
- **Key exists**: the device shows two ways in.

**Approve from a device you already use** (the default):

1. The new device makes a temporary age identity and posts a join request
   with its public part and its name.
2. Every signed-in device of the person shows "**<name>** wants to join. Do
   these words match the ones on it? apple · river · seven · lamp · north ·
   cedar" with Approve and Deny. The same six words show on the new device.
   They are derived from the SHA-256 of the temporary public key together
   with the library's public recipient: the approving device uses the
   recipient of the key it holds, the new device the recipient the server
   names. Six words from a 256-word list carry 48 bits, so a server would need
   about 2^48 key generations to find a look-alike within the 10 minutes a
   request lives (three words, 24 bits, took minutes on one core and were
   dropped in review). A server that swaps either key shows different words
   (the Matrix and Bitwarden pattern).
3. Approve encrypts the library key to the temporary key and posts it. The new
   device decrypts it and keeps it (§4.4) only if its public recipient is the
   one the words were made from; anything else is refused ("not the key the
   words were made for"). This also stops a server that answers "approved"
   by itself with a key it made up. The temporary identity is then forgotten.
   The server only ever relays ciphertext. A request expires after 10 minutes.

There is no QR shortcut: a scanned code would carry the new device's key past
the server, but the new device still learns the library's recipient from the
server, so the words would need comparing anyway.

**Enter the recovery key**: paste, type, or scan its QR code. The device checks
it against the library's public recipient before using it.

### 5.4 Checking the identity provider's token (fixes 0.9.5)

The id_token is verified with `jsonwebtoken`:

- **Signature** against the keys at the discovery `jwks_uri`, cached, one
  refetch on an unknown `kid`, at most once a minute.
- **Algorithm** from an allow-list (RS256, RS384, RS512, PS256, PS384, PS512,
  ES256, ES384, EdDSA), matching the key's `alg` when the key declares one and
  its key family always; `none` and HMAC refused.
- **The sign-in is bound to its browser**: `/auth/login` sets a 10-minute
  `HttpOnly`, `SameSite=Lax` cookie with the login `state`, and the callback
  refuses a `state` that does not match it, so a link carrying someone else's
  code cannot sign a person into the wrong library.
- **The issuer must be HTTPS** like the public address (localhost excepted),
  since the client secret and refresh tokens travel to it.
- **Claims**: `iss` equals the configured issuer; `aud` contains the client id,
  and `azp` equals it when there are several audiences; `exp` future, `iat`
  not future, `nbf` passed, 60 s leeway; `nonce` matches; `sub` non-empty.

`parse_claims` is deleted.

### 5.5 Device tokens

256 random bits, base64url, prefixed `ins_`; stored as SHA-256 only; valid
until revoked or 180 days unused; at most 100 devices per person. Revoking is
possible from any of the person's devices.

### 5.6 Re-checking people with their identity provider (owner's decision, 2026-10-12)

A person the identity provider no longer accepts stops syncing within a day.

**Mechanism: the OAuth 2.0 refresh token**, kept server-side. Chosen because it
is the one standard check every common self-hosted provider supports, checked
against each provider's source on 2026-10-12: Pocket ID (since v0.44.0),
Authentik, Keycloak, Zitadel and Kanidm issue refresh tokens to a confidential
client and refuse a refresh for a disabled or deleted person; Authelia and Dex
issue them but do not re-check the person on refresh (Dex depends on its
connector). The alternatives were weaker: token introspection reports a
disabled person reliably in Authentik only; back-channel logout fires on
disable in Pocket ID and Authentik but needs the provider to reach the server;
UserInfo cannot tell an expired token from a refused person; Shared Signals and
SCIM are rare or enterprise-only.

Confirmed live on a throwaway Pocket ID v2.16.0 (confidential client, PKCE,
scopes `openid profile email`, no `offline_access`): a refresh token is
issued; a refresh while the person is enabled answers `200` with a rotated
token; after the person is disabled, `400 invalid_grant` ("The user account is
disabled."); after the person is removed from the client's allowed group,
`403 access_denied`. The client's refresh token lifetime reads 30 days.

1. **Sign-in asks for a refresh token.** The authorization request adds
   `offline_access` when the provider's discovery lists it in
   `scopes_supported` (Keycloak, Authentik, Zitadel, Authelia and Dex need it;
   Pocket ID and Kanidm issue one without it).
2. **One refresh token per person**, from their most recent sign-in on any
   browser or device that returned one (a sign-in that returns none keeps the
   stored one), in `server.db`, encrypted at rest with XChaCha20-Poly1305
   (RustCrypto, the crate age is built on) under a key derived by HKDF-SHA256
   from `INSTANTNOTES_OIDC_CLIENT_SECRET`. The secret lives in the environment,
   not the data folder, so a copied data folder alone cannot use the tokens,
   and a refresh token is useless without that secret anyway. If the secret
   changes, stored tokens no longer decrypt; that person is treated as having
   no refresh token (step 6) until they next sign in.
3. **Every hour**, for every person with at least one live device token or
   browser session, the server refreshes. An hour, not a day, because some
   providers' refresh tokens expire quickly by default (Authelia 90 minutes,
   Kanidm 16 hours); an hourly refresh keeps a rotating token alive. Persons
   are spread across the hour, at most four refreshes at a time.
4. **Accepted** (`200` with tokens): the new id_token is verified as in §5.4,
   with `sub` equal to the stored one, and the new refresh token replaces the
   old one. A rotated token is kept after every `200`, even when its id_token
   cannot be checked (rotation: Zitadel allows no reuse and Kanidm ends the
   session on reuse, so losing it would refuse the person an hour later). Every
   write is compare-and-set against the token the check read, so a sign-in
   made while a check was in flight is never undone; a refusal revokes only
   sign-ins older than the check.
5. **Refused**: a `400`, `401` or `403` from the token endpoint whose `error`
   is `invalid_grant`, `access_denied` or `invalid_request` (Zitadel answers a
   disabled person with `invalid_request`, Pocket ID a person removed from the
   app's group with `403 access_denied`). The server revokes all of that
   person's device tokens, browser sessions and pending join requests, deletes
   the refresh token, and logs `auth.refused` with the person folder. Stored
   notes, keys and objects are untouched. Each device shows "Signed out: sign
   in again", keeping its local notes and pending edits; signing in again
   works the moment the provider accepts the person again.
5b. **Lapsed, not refused**: an expired refresh token also answers
   `invalid_grant`, and a provider cannot say which. When the stored token was
   last refreshed more than 7 days ago (the server was down, or the provider
   unreachable for that long), the server deletes the token and logs
   `auth.lapsed` instead: nothing is revoked, and the person falls under the
   24-hour rule (step 7), so devices signed in more than a day ago sign in
   again. For the person the result is the same as a refusal; the log and the
   breaker are not misled by a fine person.
5a. **The server's own setup is wrong**: any other `4xx` (`invalid_client`
   after the client secret was changed at the provider but not in the
   environment, `unauthorized_client`, `unsupported_grant_type`,
   `invalid_scope`, `429`, or a `4xx` with no OAuth error). Nothing is
   revoked; the server logs `auth.recheck.misconfigured` with the error, and
   `/healthz` answers `503` with it until a re-check succeeds.
5b. **Breaker**: when more than half of the persons checked in one hour, and
   more than three, are refused, the server stops revoking for that hour, logs
   `auth.recheck.breaker`, and reports it on `/healthz`. Many refusals at once
   point at a fault, not at many disabled people. The count runs over the
   hour, across checks: up to three people refused early in an hour are
   revoked before it can trip. A reported problem clears only after a run with
   an accepted check and no failure.
6. **Unreachable** (no connection, a timeout, or a `5xx`, from the token
   endpoint, discovery or the published keys) is not a refusal: syncing
   continues, the server logs `auth.recheck.unreachable` once per outage, and
   retries at the next hour. When discovery itself cannot be reached, the
   whole hour's batch is skipped at once instead of waiting on each person.
   The re-check runs as its own task, with a 5-second connect timeout. Dex answers a connector failure with
   `500`; that is treated as unreachable, so with Dex a person removed only in
   its upstream connector stops at the 24-hour fallback below, not sooner.
7. **No refresh token** (the provider issued none, or step 2's decryption
   failed): that person's device tokens and browser sessions must sign in
   again 24 hours after their last sign-in. Settings says why: "Your server's
   sign-in provider doesn't allow longer sign-ins, so this device signs in
   again each day."

**Where "within a day" is not met.** A refresh only catches a disabled person
if the provider checks the person when it refreshes. Authelia does not, and
Dex only does when its connector does (and answers a connector failure with
`500`, read as unreachable). With those providers a disabled person keeps
syncing until their refresh token expires (Authelia's default is 90 minutes,
so in practice soon; Dex's is unlimited by default) or until revoked in
Settings. The README names this per provider kind rather than promising it.

The same refusal also follows from the provider's own session limits (for
example Keycloak's maximum session length without `offline_access`): the
devices then sign in again. That is the provider's policy taking effect, and
nothing stored is lost.

README line: "When your identity provider stops accepting a person (disabled,
deleted, or removed from the app), their devices are signed out within an hour
or two, and at most within a day, as long as the provider checks the person
when the server refreshes their sign-in (Pocket ID, Authentik, Keycloak,
Zitadel and Kanidm do; Authelia does not, and Dex depends on its connector).
Their stored notes stay on the server."

### 5.7 How many steps a person takes

| Moment | Steps |
| --- | --- |
| First device | Choose Sync server, type the address, sign in at the identity provider, Allow, save the recovery key. |
| Each further device | Type the address, sign in, Allow; on a device already in use, check six words and tap Approve. |
| A browser | Open the address, sign in; approve on a device already in use. Remembered after that. |
| Everyday use | None. Notes open and sync with no prompt. |
| Lost every device | Install, sign in, enter the recovery key. |
| Encryption off | Every further device and browser: type the address and sign in. Lost every device: sign in. |

## 6. API

Under `/sync/v1`, JSON unless noted. Every route except `info` and the sign-in
pages takes a device token (`Authorization: Bearer`) or a browser session
cookie with the `X-InstantNotes` header.

| Route | Purpose |
| --- | --- |
| `GET info` | `{ app: "instantnotes", api: 1, version, maxObjectBytes }`. No auth. |
| `GET device/authorize`, `GET device/confirm`, `POST device/allow`, `POST device/token` | Desktop sign-in (§5.1). |
| `GET keys` | `{ libraryId, mode, recipient, epoch, head }`; mode and recipient none yet on a new library. |
| `PUT keys` | First device only: sets the mode and, encrypted, the public recipient; refused when set. |
| `POST keys/requests` | A new device's join request: temporary public key, device name. |
| `GET keys/requests` | Pending requests, for approving devices (long-poll capable). |
| `POST keys/requests/{id}/approve`, `.../deny` | The encrypted library key, or a refusal. |
| `GET keys/requests/{id}` | The new device waits here for the answer. |
| `GET changes?since=&limit=&wait=` | `{ libraryId, head, changes: [{ name, sha, size, deleted, seq }], more }`. Pages end on commit boundaries; `wait` up to 25 s; `410` when `since` is ahead of the head. |
| `POST blobs/missing` | Which of up to 1,000 ciphertext SHAs the server lacks. |
| `PUT blobs/{sha}`, `GET blobs/{sha}` | Ciphertext bytes; the hash is checked while streaming; this person's store only. For objects too large to batch. |
| `POST blobs/batch` | Many blobs in one body, each framed as an 8-byte length, the 32-byte SHA-256 and the bytes; up to 32 MiB. Each is hash- and size-checked. |
| `POST blobs/fetch` | `{ shas }` (up to 1,000) to the same frames, as many as fit in 32 MiB; the device asks again for the rest. |
| `POST commit` | `{ epoch, ops: [{ name, base, sha }], reset }`, all or nothing: `200 { head }`, `409 { conflicts }`, `409 WRONG_EPOCH`, `400` for a bad name or a missing upload. `epoch` is the current one, or the next while staging a switch (§4.10), when `reset` clears that staging epoch first. |
| `POST switch` | `{ fromEpoch, builtAt, mode, recipient, expected }` (§4.10): `200 { epoch }`, `409 CONFLICT` when the old epoch moved, `409 INCOMPLETE`, `409 WRONG_EPOCH`. |
| `GET devices`, `DELETE devices/{id}`, `DELETE devices` | List, revoke one, sign out everywhere. |
| `GET legacy`, `GET legacy/attachments/{name}`, `DELETE legacy` | §8.2 only, while this person's 0.9.5 web library exists; `404` otherwise. |

`/healthz`: `200 ok` when the data folder is writable and `server.db` opens,
`503` with a reason otherwise.

## 7. Server storage

```
<INSTANTNOTES_DATA_DIR>/
  server.db                     devices, browser sessions (hashed tokens), sealed refresh tokens
  sync/<person>/
    index.db                    objects(epoch, name, sha, size, seq, device, at),
                                meta(library_id, epoch, head, mode, recipient),
                                joins(id, public_key, device_name, created_at, answer, denied)
    blobs/<2 hex>/<sha256>      ciphertext, one per distinct content
  libraries/<person>/           0.9.5 web libraries, only until moved (§8.2)
```

- `<person>` is 0.9.5's `folder_name(sub)`: the `sub` when plain (letters,
  digits, `-`, `_`, up to 128), its SHA-256 otherwise; never from anything
  typed. Folders `0700`, files `0600`.
- One lock per person serializes commits; `index.db` runs in WAL mode; a commit
  is one transaction: check every base, write every row under the next
  sequence number, wake that person's long-polls.
- Uploads stream to a temporary file in the person's `blobs/`, hashed on the
  way, renamed into place only when the hash matches.
- Unreferenced blobs older than 24 hours are swept once an hour, in each store
  opened since the server started (a person who has not synced since a restart
  is swept on their next visit). A blob is checked again under the store's
  lock right before it is deleted, a commit checks its blobs under the same
  lock, and `blobs/missing` refreshes the age of a blob it reports present, so
  a sweep never takes a blob a device is about to commit.
- No per-person storage quota: the operator's disk is the limit (§12).

**Isolation.** The person comes only from the token's or session's row. No
request field names a person. Stores and blobs live under the person's own
folder, so a hash from another person's store is "not found". Object names
must be 64 lowercase hex characters, so nothing in a name can reach a path.
And with end-to-end encryption, even a bug that let one person fetch another's
blob would hand over ciphertext without a key. `isolation_test.rs` covers:
another person's token cannot list, download (even by a known hash), commit,
approve a join request, read a recipient, or revoke anything.

## 8. Joining existing libraries

### 8.1 A device with notes

The owner's case: a Linux library and a Mac library become one.

The rule, in the owner's words (D4): "most of it should be automated, but
anything that is not 100% safe should let the user decide on the spot." What
other apps do, checked on 2026-10-12: no notes app documents removing identical
notes at first sync (Joplin keeps them as two notes, and duplicate complaints
are common); the review screens people know (Notesnook, Google Keep, Apple
Photos, Google Contacts) offer keep one or keep both, put a discarded copy in a
recoverable trash, and offer "merge all" only for exact copies.

1. **Ask before anything moves.** When a device with notes joins a server that
   already holds notes: "This server has 812 notes and this device has 640.
   They'll be combined into one library. Exact copies are combined; anything
   that might be the same note is kept twice and shown to you to decide. This
   device's library is backed up first." **Combine** or **Cancel**. Nothing
   offers to replace one side with the other: that loses notes. A browser
   does not ask: it joins as a new device, and anything it already holds (the
   notes moved from a 0.9.5 web library, §8.2, or typed before its first
   sync) is merged by the same rules below.
2. **Backup.** `VACUUM INTO <app data>/backups/library-before-sync-<date>.db`,
   keeping the newest three; Settings names the file.
3. **Everything pending.** Every local note is marked dirty with no bases.
4. **Pull** the whole server library, and sort each pair of notes:

| Case | Safe? | What happens |
| --- | --- | --- |
| A note on one side only | yes | Kept. |
| Same id, equivalent (vault §4.2) | yes | One note. |
| Different ids, the same note byte for byte: title, body, kind and surface equal once line endings are normalised | yes | One note: the arriving one, with the local note's tags and Spaces added, pinned if either was, archived only if both were, its device-local state (last opened, sticky window) moved over. The local copy goes to the Trash, so the merge can be undone from inside the app. Matching is one to one. |
| Same id, different content (edited in both libraries) | no | Both kept at once: the newer keeps the note, the other becomes a copy tagged `conflict` (vault §4.3). Listed for review. |
| Different ids, likely the same note: one body starts with the other and the shorter is 20 characters or longer (an older and a longer version), or the bodies are at least 90% alike by `similar`'s ratio and both are 200 characters or longer | no | Both kept, untouched. Listed for review. |
| Anything else | yes | Two different notes, both kept. |

   A shared title alone is never a match: two notes called "Untitled" are not
   the same note. Candidates for the likely-same rules are only compared when
   their first 32 normalised characters agree, so a large join does not compare
   every pair. The likely-same thresholds are a starting point, not
   measured; a false match costs one extra row in the review with Keep both
   already chosen.
5. **Push** everything the server lacked. Sync never waits for the review:
   both copies of every uncertain pair are already safe, so the decision is
   tidying, not rescue.

**The review.** When a join leaves pairs to look at, a **"Review merge"**
Space appears, built the way the update notification is (`SEQUENCE.md` §13a):
a synthetic Space, stored nowhere but this device's settings
(`sync.mergeReview`), gone when the last pair is decided. The finished join
says: "Your libraries are one: 1,204 notes, 37 exact copies combined, 6 pairs
to look at." Opening a pair shows the two versions side by side with their
differences marked (`@codemirror/merge`), and three choices:

- **Keep both** (already in effect; removes the pair from the list)
- **Keep this one** (the other goes to the Trash)
- **Keep that one** (this one goes to the Trash)

There is no automatic "combine the text": to combine, the person edits one
note and keeps it. **Leave all as they are** clears the list at once. The
exact copies combined automatically are listed at the top with **Undo** (the
local copy comes back from the Trash as its own note). Every choice goes to the
Trash, never past it. Decisions reach the other devices as ordinary edits
and trash moves.

Linux joins first; the server is empty, so nothing is asked and everything
uploads. The Mac joins second, asks, combines, and lists what needs a look;
Linux pulls the result. A join never destroys a note.

### 8.2 A 0.9.5 web library on the server

A person who used 0.9.5's web mode has a plain library on the server. It
stays read-only until moved:

1. The first device of that person to sync after the upgrade (desktop or
   browser) fetches them over HTTPS: `GET legacy` returns every note as vault
   Markdown with its surface, the manifest (tags and Spaces), and attachment
   names; `GET legacy/attachments/{name}` returns each image. The device
   checks every name before writing it.
2. It imports them as its own notes, keeping ids, times, tags and Spaces
   (`Store::import_legacy`): a note it already has unchanged is skipped; one
   with the same id but different content is kept twice, the copy tagged
   `conflict`. Then its ordinary sync pushes them, encrypted when the library
   is, and §8.1's rules apply on every other device.
3. Only after a sync that reached the server with no errors does it call
   `DELETE legacy`; the server deletes `libraries/<person>/` and logs
   `legacy.removed`. The step is kept in the library (`sync.legacy`), so an
   interrupted move resumes, and a device that finds nothing (`404`) never
   asks again.

Until then the server serves that library to nobody else and keeps it. The
README tells operators that server backups taken before the move still hold
those notes in plain text.

## 9. The browser

**Proven first** (owner's decision, 2026-10-12): before the rest of this
section is built, a spike runs the core compiled to WebAssembly, rusqlite on
`sqlite-wasm-rs` with OPFS (`sahpool`), in a Web Worker, in iPhone Safari,
writing a note and reading it back after a page reload. If it fails, work on
this section stops and the owner gets the options. The spike already found two
changes the core needs on WebAssembly: the `truncate` journal mode instead of
WAL (the browser storage does not support WAL), and reading the time through
`chrono` instead of `std::time::SystemTime` (which panics there). In headless
Chrome it wrote, reloaded and read back a note, and full-text search found it.
**Result, 2026-10-12: passed in Safari on the owner's iPhone** (a tailnet-only
HTTPS test page, removed after the test): the note written before the reload
was read back after it, from OPFS.

- **The core in a worker.** A new crate, `src-tauri/web`, compiles
  `instantnotes-core`, the sync engine and `age` to WebAssembly and runs them in
  a dedicated Web Worker. SQLite runs through `sqlite-wasm-rs` with the
  `opfs-sahpool` storage, which needs no special server headers and keeps the
  database in the browser's private storage. (Checked: the core builds for
  `wasm32-unknown-unknown` with two target-only features, `uuid/js` and
  `chrono/wasmbind`; rusqlite 0.40 uses `sqlite-wasm-rs` there by default.)
- **The same UI.** On the web, `call()` in `src/lib/api/client.ts` posts to the
  worker instead of `/api/<command>`, and `listen()` hears the worker's events
  instead of the server's SSE stream. The 40 web commands keep their names and
  arguments: their dispatch moved from the server into the core
  (`instantnotes_core::commands`), so the worker runs exactly the code the
  server ran. The sync commands keep the desktop's names and answer with the
  same `SyncServerStatus`, from `src/lib/web/sync.ts`, so Settings and the
  join and review screens are the same components. The server's
  `/api/<command>` routes and its per-person `Store` are removed.
- **Never blocking on the network.** The sync engine is async (`Remote` is an
  async trait), so the worker answers the UI between requests. The desktop
  runs the same engine with `block_on` on its sync thread. The worker's
  `Remote` is a small `fetch` client (`src-tauri/web/src/remote.rs`) sharing the
  core's frame format and error mapping with the desktop's `reqwest` one; the
  two long-polls (changes, join requests) run on the page, not in the worker.
- **Images.** The browser has no folder, so attachments live in the same
  database (`attachment_files(name, bytes)`); the core reaches them through
  `Attachments::{Folder, Database}`. Image URLs stay `/api/attachments/<name>`:
  the service worker answers them by asking the page, which asks the worker.
- **Built only for the image.** The worker and its WebAssembly are plain files
  under `static/web/` (`worker.js`, and `pkg/` built by
  `scripts/build-web-core.sh`), outside Vite's module graph, so the desktop
  builds and their CI need no WebAssembly toolchain. The Dockerfile's `web`
  stage (Debian trixie, for a clang new enough for SQLite's C shim) builds
  them; the bundle is about 2.5 MB before compression.
- **One tab at a time.** The browser storage allows one open database per
  site. A second tab shows "InstantNotes is open in another tab" with **Use
  here**, which moves the library to that tab (Web Locks). A tab that loses
  the library stops its worker for good until it reloads.
- **One library per browser.** The browser's copy belongs to the site, not to
  a person. "Sign out of this browser" removes the copy and the key. A
  browser whose copy belongs to another library (another person signed in,
  or the server was rebuilt) does not sync it: Settings > Sync says so and
  offers **Clear this browser**. Nothing from one library is ever pushed
  into another. Sync and its screens open on their own on the web when they
  need the person (`off`, `needsKey`, `recoveryKey`, `confirmPlain`,
  `otherLibrary`); the command palette also has "Open settings".
- **Timeouts.** Every request has a timeout (60 s, plus the wait for a
  long-poll), so a stalled connection cannot freeze sync until a reload.
- **Offline.** A service worker keeps the app's files, so a browser or phone
  that has opened the app once opens it and edits offline; changes sync when
  it reconnects.
- **Keeping the local copy.** The app asks for persistent storage. Safari may
  still clear site data after long disuse; a home-screen app keeps it longest.
  When the copy is gone, the browser downloads it again and asks for the key
  as a new device would.
- **Desktop-only features** stay hidden on the web (`isWeb`), as in 0.9.5.
- **The sign-in page** (`statics::signed_in`, built on `0.10.0-pre`) drew the
  person's notes as its background from the server's library (`note_sizes`).
  With no server-side library, the server's page only hands off, and the app
  draws that background from the browser's local copy once it opens; a
  browser with no copy yet shows it empty until the first pull.

## 10. Limits

| What | Limit | Why |
| --- | --- | --- |
| One object | 64 MiB stored, `INSTANTNOTES_MAX_OBJECT_MB` | With encryption on, padding (§4.3) rounds above 64 KiB to a power of two, so the real limit is plain content under 32 MiB, and an image under about 24 MiB (it travels base64 in its envelope). With encryption off, about 48 MiB for an image. A sheet at its cap fits; a bigger object stays on its device and Settings names it. |
| Changes per commit | 5,000 | One short transaction; a bigger first upload uses several. |
| Changes per page | 1,000, whole commits | Bounded responses. |
| Hashes per `blobs/missing` | 1,000 | Bounded request. |
| Devices per person | 100 | The oldest unused is revoked beyond that. |
| Join request | 10 minutes | Short window for the relay. |
| Long-poll | 25 s | Below common proxy timeouts. |
| Library size | 20,000 notes tested, desktop and browser | The size the 0.9.4 speed work measured. |

## 11. Security review

| Topic | This change |
| --- | --- |
| Notes at rest on the server | Ciphertext only (§4). |
| Transport | HTTPS only: the desktop refuses `http://` except to this computer; the server refuses an `http://` public address that is not localhost, sends HSTS, marks cookies `Secure`. |
| Identity provider tokens | Fully verified (§5.4). |
| Device tokens and sessions | Random, hashed at rest, revocable, expiring unused (§5.5); revoked when the identity provider refuses the person, checked hourly (§5.6). |
| Keys | On devices only (§4.4); handed over encrypted, with six words to compare (§5.3). |
| Isolation | §7, with tests; and ciphertext without a key even if it failed. |
| Rate limits | `governor`: sign-in pages 30 a minute per address; `device/token` 10; join requests 5 a minute per person; sync API 600 a minute per device; more than 20 refused tokens a minute from one address gets `429`. Client address from the socket, or the last `X-Forwarded-For` hop (the one the trusted proxy appended; earlier hops are the client's to write) with `INSTANTNOTES_TRUST_PROXY=true`. Idle entries are dropped every minute. |
| Cross-site requests | Cookie routes require the `X-InstantNotes` header (0.9.5). Bearer routes take no cookie. |
| Logs | Person folder, device id, counts and byte totals; never content, names or titles. |
| Stolen device, unlocked | The thief reads that device's library, as with any app. Revoke it from another device; it can then fetch nothing new. |
| Stolen device, off | Protected by the device's disk encryption; the key is in the system keychain. |
| Stolen server or backups | Ciphertext, padded sizes, timings, device names, hashed tokens, and the OIDC client secret (it can impersonate the server to the identity provider, not read notes). |
| A malicious server | Cannot read stored notes. Cannot turn encryption off or swap the key for devices that hold it (§4.10 marker and recipient check). Could withhold data, roll back the whole library (detected as §3.7, recovered by keep-both) or single objects (not detected; the device keeps its newer copy and sends it again only when edited), refuse service, or, for the browser only, send altered code (§4.8). Cannot swap in its own key during a join, or invent an approval, without the words differing (§5.3). Cannot tell a device that holds the key from one that only signed in; a signed-in device without the key can still delete objects, which the removal guard (§3.6) holds for confirmation, and a switch-over must carry every live object (§4.10). |
| Harvest now, decrypt later | X25519 is not post-quantum. age's post-quantum recipient rests on an IETF draft; switching to it later means changing the library key (§4.6). |

## 12. Self-hosting

README section "Self-hosted sync":

```
docker run -d --name instantnotes \
  -p 8080:8080 \
  -v /srv/instantnotes:/data \
  -e INSTANTNOTES_PUBLIC_URL=https://notes.example.org \
  -e INSTANTNOTES_OIDC_ISSUER=https://id.example.org \
  -e INSTANTNOTES_OIDC_CLIENT_ID=instantnotes \
  -e INSTANTNOTES_OIDC_CLIENT_SECRET=... \
  ghcr.io/jam-sw/instantnotes-server:<version>
```

| Setting | Required | Meaning |
| --- | --- | --- |
| `INSTANTNOTES_PUBLIC_URL` | yes | The address people type, `https://`. |
| `INSTANTNOTES_OIDC_ISSUER` | yes | The identity provider's issuer URL. |
| `INSTANTNOTES_OIDC_CLIENT_ID`, `_CLIENT_SECRET` | yes | A confidential client at the provider. |
| `INSTANTNOTES_DATA_DIR` | set by the image (`/data`) | Everything the server keeps. Back it up; it holds ciphertext. |
| `INSTANTNOTES_LISTEN` | set by the image (`0.0.0.0:8080`) | |
| `INSTANTNOTES_TRUST_PROXY` | no | `true` behind a reverse proxy that sets `X-Forwarded-For`. |
| `INSTANTNOTES_MAX_OBJECT_MB` | no | Largest object, default 64. |

- **At the identity provider**: one confidential client, scopes `openid
  profile email`, callback `https://<address>/auth/callback`, post-logout
  redirect `https://<address>`. Desktop apps need nothing registered.
- **In front**: a reverse proxy with TLS; a read timeout above 30 s for the
  long-poll.
- **Health**: `GET /healthz`.
- **Who can sign in** is decided at the identity provider; everyone it lets
  through gets their own library. When the provider stops accepting a person
  (disabled, deleted, or removed from the app), their devices are signed out
  within an hour or two, and at most within a day, on providers that check
  the person when a sign-in is refreshed; their stored notes stay on the
  server (§5.6).
- **Refresh tokens**: allow the client the refresh token grant and, where the
  provider has it, the `offline_access` scope (Authelia also asks the person
  to consent to it). Without refresh tokens, devices sign in again each day.
- **What you can see as the operator**: §4.7. You cannot read or recover
  anyone's notes.
- `INSTANTNOTES_VAULT_ROOT`, built on `0.10.0-pre` and never released, is
  removed (decision D3): the server can no longer read notes, so it cannot
  sync a folder.

## 13. Testing

- **Core** (`core/tests/server_sync_test.rs`, an in-memory server): offline
  catch-up after many commits; keep-both for documents, whiteboards and sheets
  (both survive, one tagged `conflict`); trash, restore and destroy travelling;
  rename; attachments both ways; the manifest merging from both sides; a 409
  resolved on the next cycle; a server rolled back (§3.7) losing nothing; the
  removal guard; the join of two existing libraries (exact copies once and
  undoable, same-id differences kept both and listed, likely-same pairs kept
  and listed, same-title-only pairs not listed, everything else present, tags
  and Spaces unioned, each review choice moving only to the Trash); the 0.9.5
  legacy move. Every sync case runs with encryption on
  and off. Flipping: on and off with other devices offline and editing during
  the switch-over; a refused switch retried; nothing lost; the old epoch's
  blobs gone from the server afterwards.
- **Encryption**: age test vectors; padding; name derivation stable across
  desktop and WebAssembly builds; a wrong recovery key refused; join words equal
  on both sides and different for a swapped key.
- **Server**: commit atomicity and bases, paging, long-poll wake, hash and size
  checks, name checks, isolation (§7), JWKS checks (§5.4), device sign-in
  (redirect allow-list, one-time code, PKCE), join request relay and expiry,
  rate limits, revoke, legacy export and delete.
- **Browser**: the core's tests run under WebAssembly in headless Chromium
  (`wasm-pack test`), including OPFS storage and the one-tab lock.
- **End to end** (`server/tests/sync_e2e_test.rs`, ignored by default, run by
  `scripts/sync-e2e.sh`): the built image, a throwaway Dex identity provider
  (static test user, RS256 keys), two desktop clients through the real device
  sign-in and join approval, and the web app in headless Chromium, on one
  library: a note made in each appears in the others; an offline edit arrives
  after reconnecting; a conflict leaves both versions; the server's data folder
  contains no note text.
- **In the app** (tasks.md): two desktop builds, a computer browser and a phone
  browser on one throwaway server.

## 14. Decisions for the owner

### D1. End-to-end encryption (decided 2026-10-12)

Ships in this change, everywhere, with room for an iOS app later.

### D6. Encryption: a switch, on by default (decided 2026-10-12)

The owner chose a switch over always-on. Off trades privacy from the server
for joining by sign-in alone and recovery without a recovery key. The cost is
two modes to build and test, and a switch-over when it is flipped (§4.10).

### D2. Desktop sign-in: through the server (decided 2026-10-12)

One client and one callback at the identity provider; the app asks only for
the address; revocable device tokens; the iOS app later adds a custom-scheme
redirect. Rejected: signing in directly at the provider, which needs a second,
public client with a loopback redirect accepting any port.

### D3. `INSTANTNOTES_VAULT_ROOT`

Removed (§12). With the server unable to read notes, there is no other
option; recorded here because it is in 0.10's unreleased code.

### D4. Joining libraries (decided 2026-10-12)

The owner: "most of it should be automated, but anything that is not 100% safe
should basically let the user decide on the spot." Designed in §8.1: ask before
anything moves; combine only exact copies, undoably; keep both of everything
uncertain and list it in a "Review merge" Space with Keep both, Keep this one,
Keep that one.

### D5. Version: folded into 0.10.0 (decided 2026-10-12)

Folder sync and Sync server ship together as 0.10.0, image
`ghcr.io/jam-sw/instantnotes-server:0.10.0`. The work is built on
`feat/sync-server` and merged locally into `0.10.0-pre`, so PR #78 carries it;
`INSTANTNOTES_VAULT_ROOT` never ships. Merging and releasing stay the owner's.

### D7. Passkey unlock in browsers

Not in this change. Unlocking the key with a passkey (WebAuthn PRF) works in
recent Chrome and Firefox, but Safari has shipped bugs, synced passkeys have
returned different values across devices, and the Linux desktop's web view has
no WebAuthn at all. A browser keeps its key until it signs out, which covers the same everyday need. The
key design leaves room to add it as one more way in.

### D8. Phone layout: not yet (decided 2026-10-12)

The app has no phone layout: its fixed two-column grid cuts the editor off at
phone width. The owner chose not to add a quick one here: "I don't want to
just throw together a hacky solution, it's required that it's properly built
and done." The web app is still served to phones as it is, and sync works
there; the README and the changelog say the layout is not designed for phones
yet. A proper phone and tablet layout, then native iOS and iPadOS apps, are
the next pre branch's work (planned outside this change). New components here
must not assume the two-column grid, so that work can start from them.

## 15. Research and rejected options

Checked on 2026-10-12 against primary sources (crates.io, npm, specs, vendor
documentation), with two compiled checks in this repo.

- **Existing sync engines** (Evolu, Automerge, Yjs, Loro, cr-sqlite, Electric,
  PowerSync, Jazz, Triplit, Ditto, Any-sync, Zero, Syncthing): none has
  end-to-end encryption, a self-hostable server and Rust, browser and iOS
  clients together. Evolu is closest in model but has no Rust client.
- **A virtual folder in the browser** so 0.10's file engine runs unchanged:
  rejected. It doubles storage, keeps file names as identities, and the
  browser's storage allows one open handle at a time. The deciding rules are
  reused instead (§3.4).
- **libsodium** instead of age: audited (2017), but it would need a file format
  of our own around it, and a second implementation in JavaScript.
- **A passphrase-derived key** (Argon2id or scrypt): one more secret to
  remember, and a weak one can be guessed offline by whoever holds the server.
  Device approval and a recovery key need no password.
- **PAKE codes** (SPAKE2, CPace) for joining: no audited Rust crate and no
  maintained JavaScript library; short codes give an active relay a guess per
  try. The six-word comparison is simpler and proven.
- **Syncing whole files** (this design's first version): a browser and an
  iPhone have no shared folder, and file names carry titles.
- **Server-side merging, last-write-wins, pruning tombstones**: as before;
  each loses data or forces a "start over" case.
- **Web code transparency** (WEBCAT, WAICT, Isolated Web Apps): experiments or
  enterprise-only today; watched, not used.
- **Tauri on iOS** (later): Tauri 2.12 is stable on iOS; sign-in needs
  `ASWebAuthenticationSession` with a custom scheme and a small Swift plugin
  for it and the Keychain, since no official plugin covers either. App Review
  needs a reachable demo server. Nothing in this change blocks it.
