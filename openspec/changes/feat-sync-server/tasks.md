# Tasks: Sync Server

Every decision in design §14 is made. Blocked on the owner's approval of the
plan. Ships in 0.10.0: built on `feat/sync-server`, merged locally into
`0.10.0-pre` when done; nothing pushed.

## 0. Before building

- [ ] Owner's answers recorded in `design.md` §14
- [ ] Generic names where 0.10.0-pre names the maintainer's server or tailnet: `SEQUENCE.md` (unit 9 note), `feat-vault-sync/tasks.md` (the two-device check), `SettingsVault.test.ts` and `vault-mirror.test.ts` fixtures
- [ ] `feat-vault-sync/tasks.md`: delete the in-app check of the desktop app and the web app on one person folder (the server-side folder sync it checks is removed, D3)
- [ ] Draft for the owner: PR #78's new title and body (Summary, Changes, ADDED Requirements, Scenario, Verification) covering folder sync and Sync server; the owner edits GitHub

## 1. Identity provider tokens (`instantnotes-server`)

- [ ] `oidc.rs`: id_token verified with `jsonwebtoken` against the discovery `jwks_uri` (design §5.4); `parse_claims` deleted
- [ ] Tests with a throwaway signing key: valid accepted; wrong key, `alg: none`, HMAC, wrong issuer, audience, `azp`, nonce, expired, not yet valid each refused

## 2. Grants, HTTPS, limits (`instantnotes-server`)

- [ ] `server.db`: hashed browser sessions (surviving a restart) and device tokens (`ins_`, 180 days unused, 100 per person)
- [ ] HTTPS rule for `INSTANTNOTES_PUBLIC_URL`; HSTS
- [ ] `governor` limits (design §11); `INSTANTNOTES_TRUST_PROXY`
- [ ] `/healthz` checks the data folder and `server.db`
- [ ] Tests for each

## 2a. Identity re-check (design §5.6)

- [ ] `offline_access` requested when discovery lists it; the refresh token stored per person, encrypted at rest (XChaCha20-Poly1305, key by HKDF from the client secret), replaced on every sign-in and every refresh
- [ ] Hourly re-check of every person with a live device token or session, spread over the hour, at most four at once
- [ ] Accepted: rotated token saved in the same transaction; new id_token verified, same `sub`
- [ ] Refused (`400`/`401` with `invalid_grant`, `access_denied` or `invalid_request`): all device tokens, sessions and join requests of that person revoked, refresh token deleted, `auth.refused` logged, stored data untouched
- [ ] Misconfigured (any other 4xx, including `invalid_client` and `429`): nothing revoked, logged, `/healthz` 503 until a re-check succeeds
- [ ] Breaker: more than half and more than three refused in one hour stops revoking for that hour, logged, on `/healthz`
- [ ] Unreachable (network error, timeout, 5xx): nothing revoked, logged once per outage, retried next hour
- [ ] No refresh token: device tokens and sessions of that person need a fresh sign-in 24 hours after the last one; status says why
- [ ] Tests against a fake provider: refused (each of `invalid_grant`, `invalid_request`, `access_denied`), accepted (rotation saved, data untouched), unreachable (connection refused, timeout, 500), misconfigured (`invalid_client`, `429`), the breaker, no refresh token (24-hour limit), a changed client secret
- [ ] README line (design §12) replaces the old 180-day line

## 3. Encrypted object store and API (`instantnotes-server`)

- [ ] `sync/<person>/index.db` and `blobs/`; per-person lock; WAL; hourly sweep
- [ ] `info`, `changes` (commit-boundary pages, `wait`, `410`), `blobs/missing`, `PUT`/`GET blobs`, `commit` (all or nothing, bases, `409`), `devices`
- [ ] `keys`, `keys/requests` (create, list with long-poll, approve, deny, wait; 10 min expiry; 5 a minute per person)
- [ ] Name rule: 64 lowercase hex
- [ ] Epochs and mode in `meta`; the `switch` commit (old-epoch head check, current epoch moved, old epoch's rows and blobs deleted at once); the recipient set and cleared with the mode
- [ ] Tests: atomicity, bases, paging, long-poll wake, hash and size checks, name rule, request relay and expiry, sweep
- [ ] `isolation_test.rs` rewritten for the object store (design §7)

## 4. Desktop sign-in (`instantnotes-server`)

- [ ] `device/authorize` (loopback-only redirect), OIDC when no session, confirm page, `device/allow` (CSRF), one-time code, `device/token` with PKCE
- [ ] Tests: non-loopback redirect, code reuse, wrong verifier, expired code each refused

## 5. Core (`instantnotes-core`)

- [ ] 5.1 Split 0.10's ingest: reading files (Folder) from deciding and applying a note's bytes, so both providers share `decide`, `equivalent`, conflict copies, the removal guard; Folder's tests stay green unchanged
- [ ] 5.2 `sync_objects` table (migration); settings keys
- [ ] 5.3 `crypto.rs`: age encrypt and decrypt to the library recipient, padding (design §4.3), name key and names, join words from a public key; age test vectors
- [ ] 5.4 `ServerSync::cycle` against `StoreLock` and a `Remote` trait: pull, decide, push, 409, rollback recovery (design §3)
- [ ] 5.5 Join (design §8.1): the sorting table; exact copies combined with the local copy to the Trash and an undo; likely-same detection (prefix, `similar` ratio at 0.9 over 200 characters, never title alone); `sync.mergeReview`; the legacy move (§8.2)
- [ ] 5.5a Encryption switch (design §4.10): plain objects when off; epochs; the switch-over in both directions, retried when the old epoch moved; other devices pausing for approval when turned on
- [ ] 5.6 Target-only `uuid/js` and `chrono/wasmbind`; `cargo check --target wasm32-unknown-unknown` in `check.sh`
- [ ] 5.7 `core/tests/server_sync_test.rs` with an in-memory `Remote`: every case in design §13

## 6. Desktop (`src-tauri`)

- [ ] HTTP `Remote` (reqwest `blocking`, rustls): bearer token, `401` to signed out, `429`, backoff
- [ ] `keyring` for token and key; no keychain: Sync server refuses with a reason
- [ ] Loopback sign-in through the opener plugin; cancel
- [ ] First device: key creation and the recovery key screen (text, QR, Copy, Download, Print, "I saved it")
- [ ] Further device: join request, six words, waiting; recovery key entry checked against the recipient
- [ ] Approving: `sync:join-request` shows the request with words; Approve and Deny
- [ ] Commands and events (proposal Impact); backup before the first cycle; switching providers
- [ ] The sync thread runs `ServerSync` for `server`; long-poll wakes it

## 7. Browser (`src-tauri/web`, `src/`)

- [ ] 7.0 Spike, before anything else in this section: the core in WebAssembly, rusqlite on `sqlite-wasm-rs` with OPFS (`sahpool`), in a Web Worker, in iPhone Safari (a real device, or the iOS Simulator's Safari), writing a note and reading it back across a reload. Result reported to the owner; on failure, stop and bring the options
  - [x] Core changes it needed: `truncate` journal mode on WebAssembly; time through `chrono`
  - [x] Headless Chrome: write, reload, read back, full-text search
  - [ ] iPhone Safari

- [ ] `src-tauri/web`: wasm-bindgen worker running the core, `ServerSync`, `age`; SQLite through `sqlite-wasm-rs` with OPFS (`sahpool`); fetch-based `Remote` with the session cookie
- [ ] `client.ts` and `events.ts` talk to the worker on the web; the 40 web commands keep their names and arguments
- [ ] Key storage in IndexedDB wrapped by a non-extractable WebCrypto key; "Remember this browser"
- [ ] One-tab lock with "Use here"; service worker for offline; persistent storage request
- [ ] Join and recovery screens shared with the desktop; scanning the recovery key's QR code with the camera on phones
- [ ] Web manifest and icons; checked and fixed at 390 x 844
- [ ] Vite build of the worker and the `.wasm`; the Dockerfile builds them
- [ ] `wasm-pack test` in headless Chromium: core tests, OPFS storage, the one-tab lock

## 8. Server cleanup (`instantnotes-server`)

- [ ] `/api/<command>`, `api.rs`, the per-person `Store`, SSE events and `vaults.rs` removed; `INSTANTNOTES_VAULT_ROOT` removed and logged as ignored when set
- [ ] `legacy` export and delete for 0.9.5 web libraries
- [ ] Sign-in page: the server's page hands off without reading notes (`note_sizes` removed); the app draws the background from the local copy (design §9)
- [ ] Release image without the core's store at runtime; size checked

## 9. Settings (`src/`)

- [ ] Settings > Sync: provider choice, Folder card, Sync server card, Security group (encryption switch with its on and off wording and confirmations, recovery key, devices, sign out everywhere)
- [ ] Join prompt with both counts, Combine and Cancel; the finished-join summary
- [ ] "Review merge" synthetic Space: pairs side by side (`@codemirror/merge`), Keep both, Keep this one, Keep that one, Leave all as they are, Undo for exact copies; gone when empty; same on the web
- [ ] Tests: each state renders; switching asks first; signed out offers Sign in again; join request; devices list and revoke; join prompt; each review choice moves only to the Trash

## 10. End to end

- [ ] `scripts/sync-e2e.sh`: image plus a throwaway Dex with Docker, then `server/tests/sync_e2e_test.rs` (`#[ignore]`)
- [ ] Two desktop clients through real sign-in and join approval, and the web app in headless Chromium, on one library: each one's note appears in the others; an offline edit arrives after reconnecting; a conflict leaves both; the data folder holds no note text

## 11. Docs

- [ ] `README.md` "Self-hosted sync" (design §12), including the web-code line (§4.8) and published hashes
- [ ] `docs/API.md`, `docs/DATA_MODEL.md`
- [ ] `CHANGELOG.md` `[0.10.0]`: Sync server entries beside folder sync; the `INSTANTNOTES_VAULT_ROOT` entry removed; the sign-in page entry corrected
- [ ] `SEQUENCE.md`: this unit and its placement exception; unit 9 no longer "cuts 0.10.0" and unit 10 (git) no longer "cuts 0.11.0"; git's slot kept

## 12. Checks

- [ ] `.claude/scripts/check.sh` green; `cargo xwin check --workspace --all-targets`; the WebAssembly check
- [ ] Image builds; actionlint if a workflow changed

## In-app checks (open)

- [ ] Two desktop builds, a computer browser and a phone browser on one throwaway server: a note made in each appears in the others
- [ ] One desktop offline: typing continues, edits arrive after reconnecting
- [ ] One note edited on two devices while one is offline: both versions survive, one tagged `conflict`
- [ ] A new device approved by six words; a new browser approved the same way; a device restored by recovery key
- [ ] Encryption turned off and on again with a second device open: it carries on after off, asks for approval after on, and nothing is lost
- [ ] Join: a desktop with an existing library joins a server holding another; asked first, exact copies once, likely pairs in Review merge, each choice checked, nothing lost
- [ ] The phone browser offline after a first visit: opens, edits, syncs on reconnecting
