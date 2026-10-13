# Tasks: Sync Server

Every decision in design §14 is made; the owner approved the plan on
2026-10-12 with three changes (identity re-check, the iPhone spike first,
full paths in reports). Ships in 0.10.0: built on `feat/sync-server`, merged locally into
`0.10.0-pre` when done; nothing pushed.

## 0. Before building

- [x] Owner's answers recorded in `design.md` §14
- [x] Generic names where 0.10.0-pre names the maintainer's server or tailnet: `SEQUENCE.md` (unit 9 note), `feat-vault-sync/tasks.md` (the two-device check), `SettingsVault.test.ts` and `vault-mirror.test.ts` fixtures
- [x] `feat-vault-sync/tasks.md`: delete the in-app check of the desktop app and the web app on one person folder (the server-side folder sync it checks is removed, D3)
- [ ] Draft for the owner: PR #78's new title and body (Summary, Changes, ADDED Requirements, Scenario, Verification) covering folder sync and Sync server; the owner edits GitHub

## 1. Identity provider tokens (`instantnotes-server`)

- [x] `oidc.rs`: id_token verified with `jsonwebtoken` against the discovery `jwks_uri` (design §5.4); `parse_claims` deleted
- [x] Tests with a throwaway signing key: valid accepted; wrong key, `alg: none`, HMAC, wrong issuer, audience, `azp`, nonce, expired, not yet valid each refused

## 2. Grants, HTTPS, limits (`instantnotes-server`)

- [x] `server.db`: hashed browser sessions (surviving a restart) and device tokens (`ins_`, 180 days unused, 100 per person)
- [x] HTTPS rule for `INSTANTNOTES_PUBLIC_URL`; HSTS
- [x] `governor` limits (design §11); `INSTANTNOTES_TRUST_PROXY`
- [x] `/healthz` checks the data folder and `server.db`
- [x] Tests for each

## 2a. Identity re-check (design §5.6)

- [x] `offline_access` requested when discovery lists it; the refresh token stored per person, encrypted at rest (XChaCha20-Poly1305, key by HKDF from the client secret), replaced on every sign-in and every refresh
- [x] Hourly re-check of every person with a live device token or session, spread over the hour, at most four at once
- [x] Accepted: rotated token saved in the same transaction; new id_token verified, same `sub`
- [x] Refused (`400`/`401` with `invalid_grant`, `access_denied` or `invalid_request`): all device tokens, sessions and join requests of that person revoked, refresh token deleted, `auth.refused` logged, stored data untouched
- [x] Misconfigured (any other 4xx, including `invalid_client` and `429`): nothing revoked, logged, `/healthz` 503 until a re-check succeeds
- [x] Breaker: more than half and more than three refused in one hour stops revoking for that hour, logged, on `/healthz`
- [x] Unreachable (network error, timeout, 5xx): nothing revoked, logged once per outage, retried next hour
- [x] No refresh token: device tokens and sessions of that person need a fresh sign-in 24 hours after the last one; status says why
- [x] Tests against a fake provider (plus a `403 access_denied` and a lapsed token): refused (each of `invalid_grant`, `invalid_request`, `access_denied`), accepted (rotation saved, data untouched), unreachable (connection refused, timeout, 500), misconfigured (`invalid_client`, `429`), the breaker, no refresh token (24-hour limit), a changed client secret
- [x] README line (design §12) replaces the old 180-day line

## 3. Encrypted object store and API (`instantnotes-server`)

- [x] `sync/<person>/index.db` and `blobs/`; per-person lock; WAL; hourly sweep
- [x] `info`, `changes` (commit-boundary pages, `wait`, `410`), `blobs/missing`, `PUT`/`GET blobs`, `commit` (all or nothing, bases, `409`), `devices`
- [x] `keys`, `keys/requests` (create, list with long-poll, approve, deny, wait; 10 min expiry; 5 a minute per person)
- [x] Name rule: 64 lowercase hex
- [x] Epochs and mode in `meta`; the `switch` commit (old-epoch head check, current epoch moved, old epoch's rows and blobs deleted at once); the recipient set and cleared with the mode
- [x] Tests: atomicity, bases, paging, long-poll wake, hash and size checks, name rule, request relay and expiry, sweep
- [x] `isolation_test.rs` rewritten for the object store (design §7)

## 4. Desktop sign-in (`instantnotes-server`)

- [x] `device/authorize` (loopback-only redirect), OIDC when no session, confirm page, `device/allow` (CSRF), one-time code, `device/token` with PKCE
- [x] Tests: non-loopback redirect, code reuse, wrong verifier, expired code each refused

## 5. Core (`instantnotes-core`)

- [x] 5.1 Split 0.10's ingest: reading files (Folder) from deciding and applying a note's bytes, so both providers share `decide`, `equivalent`, conflict copies, the removal guard; Folder's tests stay green unchanged
- [x] 5.2 `sync_objects` table (migration); settings keys
- [x] 5.3 `crypto.rs`: age encrypt and decrypt to the library recipient, padding (design §4.3), name key and names, join words from both public keys; age test vectors
- [x] 5.4 `ServerSync::cycle` against `StoreLock` and a `Remote` trait: pull, decide, push, 409, rollback recovery (design §3)
- [x] 5.5 Join (design §8.1): the sorting table; exact copies combined with the local copy to the Trash and an undo; likely-same detection (prefix, `similar` ratio at 0.9 over 200 characters, never title alone); `sync.mergeReview`; the legacy move (§8.2)
- [x] 5.5a Encryption switch (design §4.10): plain objects when off; epochs; the switch-over in both directions, retried when the old epoch moved; other devices pausing for approval when turned on
- [ ] 5.6 Target-only `uuid/js` and `chrono/wasmbind`; `cargo check --target wasm32-unknown-unknown` in `check.sh`
- [x] 5.7 `core/tests/server_sync_test.rs` with an in-memory `Remote`: every case in design §13

## 6. Desktop (`src-tauri`)

- [x] HTTP `Remote` (reqwest `blocking`, rustls): bearer token, `401` to signed out, `429`, backoff
- [x] `keyring` for token and key; no keychain: Sync server refuses with a reason
- [x] Loopback sign-in through the opener plugin; cancel
- [x] First device: key creation and the recovery key screen (text, QR, Copy, Download, Print, "I saved it")
- [x] Further device: join request, six words, waiting; recovery key entry checked against the recipient
- [x] Approving: `sync:join-requests` shows the request with words; Approve and Deny; current requests read on open (`list_sync_join_requests`)
- [x] Commands and events (proposal Impact); backup before the first cycle; switching providers; "Combine or Cancel" before a library with notes joins one that has notes
- [x] The sync thread runs `ServerSync` for `server`; long-poll wakes it

## 7. Browser (`src-tauri/web`, `src/`)

- [x] 7.0 Spike, before anything else in this section: the core in WebAssembly, rusqlite on `sqlite-wasm-rs` with OPFS (`sahpool`), in a Web Worker, in iPhone Safari (a real device, or the iOS Simulator's Safari), writing a note and reading it back across a reload. Result reported to the owner; on failure, stop and bring the options
  - [x] Core changes it needed: `truncate` journal mode on WebAssembly; time through `chrono`
  - [x] Headless Chrome: write, reload, read back, full-text search
  - [x] iPhone Safari: passed on the owner's iPhone, 2026-10-12

- [x] Sync engine made async (`Remote` an async trait), so the worker never blocks on the network; the desktop runs it with `block_on`
- [x] Web command dispatch moved into the core (`instantnotes_core::commands`); attachments in the database on the web (`Attachments::Database`)
- [x] `src-tauri/web`: wasm-bindgen worker running the core, `ServerSync`, `age`; SQLite through `sqlite-wasm-rs` with OPFS (`sahpool`); fetch-based `Remote` with the session cookie
- [x] `client.ts` and `events.ts` talk to the worker on the web; the 40 web commands keep their names and arguments; the sync commands answer from `src/lib/web/sync.ts`
- [x] Key storage in IndexedDB wrapped by a non-extractable WebCrypto key
- [ ] "Remember this browser" off (memory only): not built
- [x] One-tab lock logic (Web Locks, "Use here" steals and reloads); service worker for offline files and images; persistent storage request
- [x] The "open in another tab" notice
- [x] Settings > Sync on the web (no provider choice; first-device "Set up"; "Sign out of this browser"), join and recovery screens
- [ ] Scanning the recovery key's QR code with a phone camera: not built
- [x] Web manifest and icons (phone layout: not this release, design D8)
- [x] The worker and its `.wasm` built by `scripts/build-web-core.sh` outside Vite; the Dockerfile's `web` stage builds them
- [x] Headless Chrome against the real image: the worker reads the desktops' notes, writes one, and a desktop receives it (`.claude/scripts/sync-e2e.sh`, passing)

## 8. Server cleanup (`instantnotes-server`)

- [ ] `/api/<command>`, `api.rs`, the per-person `Store`, SSE events and `vaults.rs` removed; `INSTANTNOTES_VAULT_ROOT` removed and logged as ignored when set
- [x] `legacy` export and delete for 0.9.5 web libraries; the first device to sync moves them in (desktop and web)
- [ ] Sign-in page: the server's page hands off without reading notes (`note_sizes` removed); the app draws the background from the local copy (design §9)
- [ ] Release image without the core's store at runtime; size checked

## 9. Settings (`src/`)

- [x] Settings > Sync: provider choice, Folder card, Sync server card, Security group (encryption switch with its on and off wording and confirmations, recovery key, devices, sign out everywhere)
- [x] Join prompt with both counts, Combine and Cancel
- [ ] The finished-join summary ("Your libraries are one: ..."): not built
- [x] "Review merge" synthetic Space: pairs side by side (`@codemirror/merge`), Keep both, Keep this one, Keep that one, Leave all as they are, Undo for exact copies; gone when empty; same on the web (the merge commands are in the core dispatch)
- [x] Tests: each state renders; switching asks first; signed out offers Sign in again; join request; devices list and revoke; join prompt; each review choice moves only to the Trash

## 10. End to end

- [x] `.claude/scripts/sync-e2e.sh` (local tooling, git-excluded): image plus a throwaway Dex with Docker, then `server/tests/sync_e2e_test.rs` (`#[ignore]`)
- [x] Two desktop clients through real sign-in and join approval, and the web engine in headless Chrome, on one library: each one's note appears in the others; an offline edit arrives after reconnecting; a conflict leaves both; the data folder holds no note text

## 11. Docs

- [ ] `README.md` "Self-hosted sync" (design §12), including the web-code line (§4.8) (written); the published hashes and how to compare them (open, with the release work)
- [ ] `docs/API.md`, `docs/DATA_MODEL.md`
- [ ] `CHANGELOG.md` `[0.10.0]`: Sync server entries beside folder sync; the `INSTANTNOTES_VAULT_ROOT` entry removed; the sign-in page entry corrected; a line that the web app is served to phones but not laid out for them yet (D8)
- [ ] `SEQUENCE.md`: this unit and its placement exception; unit 9 no longer "cuts 0.10.0" and unit 10 (git) no longer "cuts 0.11.0"; git's slot kept

## 12. Checks

- [ ] `.claude/scripts/check.sh` green; `cargo xwin check --workspace --all-targets`; the WebAssembly check
- [ ] Image builds; actionlint if a workflow changed

## In-app checks (open)

- [ ] Two desktop builds and a computer browser on one throwaway server: a note made in each appears in the others (phones: no layout check, design D8)
- [ ] One desktop offline: typing continues, edits arrive after reconnecting
- [ ] One note edited on two devices while one is offline: both versions survive, one tagged `conflict`
- [ ] A new device approved by six words; a new browser approved the same way; a device restored by recovery key
- [ ] Encryption turned off and on again with a second device open: it carries on after off, asks for approval after on, and nothing is lost
- [ ] Join: a desktop with an existing library joins a server holding another; asked first, exact copies once, likely pairs in Review merge, each choice checked, nothing lost
- [ ] The computer browser offline after a first visit: opens, edits, syncs on reconnecting
