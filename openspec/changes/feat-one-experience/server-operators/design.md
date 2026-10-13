# Design: The server for operators

The requirements an operator of `instantnotes-server` for several people
relayed on 2026-10-13 (handoff §4.6). Points 1 and 3 are the ones an
operator cannot work around; all five land in 0.10.1.

## 1. Per-person data folder (D8)

`INSTANTNOTES_PEOPLE_DIR`: a path template with the placeholders `{sub}`,
`{username}` (the `preferred_username` claim) and `{email}`. Example:
`/people/{username}/notes`. Unset, the layout is 0.10.0's,
`<INSTANTNOTES_DATA_DIR>/sync/<folder_name(sub)>`, and nothing changes.

Rules:

- The server's own state (`server.db`, sessions, device tokens, refresh
  tokens) stays under `INSTANTNOTES_DATA_DIR`. Only a person's store
  (`index.db`, `blobs/`) goes to the template's folder.
- Each substituted value must be a single path segment: non-empty, at most
  128 bytes, letters, digits, `.`, `_`, `-`, `@`; not `.` or `..`. A person
  whose claim fails the rule is refused at sign-in with `people_dir.invalid`
  logged (the operator chose the template; the server does not guess).
  `{username}` requires the claim to be present; a provider that does not
  send `preferred_username` is a configuration error, logged once at the
  first sign-in and the sign-in refused.
- `preferred_username` is stored in `people.username` (a new column in
  `server.db`, migrated at start) and refreshed on every sign-in, so the
  folder is resolved from the record, not from the token in hand. The
  template's folder for a person is resolved once per process and cached.
- The server creates the folder with `0700`, as the uid it runs as. A
  person's existing folder under the 0.10.0 layout is moved to the new path
  on their next request, once, logged `people_dir.moved`; a move that fails
  (another filesystem, a collision) is logged and that person's requests
  answer 503 until the operator resolves it, so nothing is duplicated.
- Two people whose values collide (one template value, two subs) are a
  configuration error: the second is refused with `people_dir.collision`.

## 2. Usage (D9)

`instantnotes-server usage [--json]` reads `server.db` and each person's
folder and prints one row per person: sub, username, email, folder, bytes
on disk, blob count, objects in the index, last seen. Runs inside the
container (`docker exec instantnotes instantnotes usage`), needs no token.

## 3. The headless check (D9)

`instantnotes-server check [--url <public url>]`: proves the sync path end to
end from outside the process, over HTTP:

1. Mints a device token for the reserved person `sub=instantnotes-check`
   (never a real identity; the people-dir template is applied to it with
   username `instantnotes-check`), valid five minutes, in `server.db`.
2. Against the URL (default `INSTANTNOTES_PUBLIC_URL`; `--url
   http://127.0.0.1:8080` reaches the process directly): `GET info`,
   `PUT keys` (encrypted mode, a throwaway age recipient), uploads one
   encrypted blob, commits it, `GET changes` until the commit appears,
   downloads the blob, decrypts it with the throwaway identity, compares.
3. Checks the stored file under the person's folder holds the ciphertext
   and not the plaintext marker.
4. Revokes the token and removes the person's folder and rows.

Exit 0 with `ok` and the timings, or 1 with the failing step. The README
documents it as the post-deploy check and states plainly that a real
device token cannot be minted non-interactively: devices sign in through the
identity provider by design, and `check` is the one exception, scoped to its
reserved person.

## 4. Read-only root

Confirmed and documented: the process writes only under
`INSTANTNOTES_DATA_DIR` (and `INSTANTNOTES_PEOPLE_DIR` when set). Blob uploads
are staged beside their final place, not in `/tmp`. A `read_only: true`
container with those volumes works; `tmpfs /tmp` is not needed. The README's
compose example says so and names the uid.

## 5. Image hygiene

- The image is built for `linux/amd64` and `linux/arm64` in one manifest
  (`release-chain/design.md` §4): the build stages run on the build
  platform and cross-compile for aarch64; only the distroless final stage is
  per platform.
- CHANGELOG rule, written into `docs/DATA_MODEL.md`'s place for the server
  and followed here: every new or renamed `INSTANTNOTES_*` variable and every
  subcommand is named in the version's section.

## 6. Tests

`people_dir`: substitution, each refusal, the move of an old folder, the
collision, the cached resolution. `usage`: a two-person fixture prints two
rows with the right bytes. `check`: against the in-process test server
(`sync_api_test.rs` fixtures) end to end, and its cleanup. Hardening test:
the data dir is the only path written during a full sign-in and sync, with
the process root mounted read-only (the test uses a temporary dir and a
`chmod` guard where the platform allows).
