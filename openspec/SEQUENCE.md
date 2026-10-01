# Work Sequence

The order changes land in, and what "landed" means. Individual changes live in
`openspec/changes/`; this file says which one is open, what precedes it, and
what follows.

No dates. Nothing here is scheduled. A unit is open until it is done, and the
next one does not start before that.

## Working rule

**One unit in flight. It lives in the working tree until it is complete.**

While a unit is open it is uncommitted work. It is not split into partial
commits, not merged half-finished, and not set aside to start something else.
The branch therefore always holds either a releasable state or exactly one
unfinished thing, and never a scatter of half-built features.

A unit is done when all of these are true:

- [ ] The feature works end to end. No stubs, no dead branches, no code paths
      only reachable by a flag nobody sets
- [ ] Every design decision it depends on is **decided**, not deferred: a
      chosen library is chosen, not "currently wired up"
- [ ] `cargo test`, `npm test`, and `npm run check` pass
- [ ] `docs/DATA_MODEL.md` and `docs/API.md` match reality if the unit changed
      storage or IPC
- [ ] The changelog carries a user-facing entry
- [ ] The unit's OpenSpec change has every task checked and is moved to
      `openspec/changes/archive/`

Only then does it commit and merge, and only then does the next unit start.

**Code on a branch is not evidence of any of this.** Nothing in the ten streams
found on `0.9.0-pre` carried a TODO or a stub marker; every one of them read as
finished and none of them was.

## Insertion rule

Anything not listed below takes its position from one question: where does it
touch persistence?

- **Changes the shape of persisted note state, or the API the store is written
  against** -> before unit 7. The vault serializer encodes that shape; changing
  it afterwards means writing the format twice.
- **Adds persisted state without changing note shape** -> after unit 9.
  Units 7 through 9 rewrite the store's write path, and anything built against
  the old one gets built again.
- **View only**: theming, editor behavior, palette, layout, list rendering,
  settings pages on the existing key/value table -> any slot between units. It
  takes a slot of its own; it does not run alongside an open unit.

---

## 0. Branch hygiene (DONE)

`0.9.0-pre` held ten entangled streams and stated one of them.

- [x] Linux fix committed (`ffb7f90`). Does **not** make Linux supported;
      `[0.7.0]` already ships an AppImage as early preview and CI already builds
      `ubuntu-22.04`
- [x] `spec.md`: dropped the two references to the `version` column that
      migration v3 removed
- [x] `0decff9` split. Its subject named only the bump-version guard, but it
      also removed an editor block the whiteboard merge had duplicated. Only the
      bump-version half survives, as `dff86b6`
- [x] **Whiteboard lifted off the branch.** Its six commits were local-only, so
      no published history was rewritten and no force-push is needed. Preserved at
      the time on `feat/note-whiteboard`, with the pre-lift state on
      `backup/0.9.0-pre-with-whiteboard`; both refs are gone now, see
      "Safety refs". This removed migration v4, the
      `react`/`react-dom`/`@excalidraw` runtime deps, and four defects from the
      release. See unit 12. Migration v4 alone came back on 2026-09-22 (see
      unit 8): pre-release builds had already applied it to real libraries.
      The whiteboard itself returned the same day, defects fixed (unit 12)
- [x] Dependabot deferred to unit 6

Verified after the lift: 298 tests, svelte-check 487 files / 0 errors, Rust green.

## The four 0.9.0 units

Seven of the ten streams are entangled in `44bea94`, which is **already pushed**.
Splitting it would rewrite published history for no product value, so they are
finished in place, grouped the way the repo already groups changes.

## 1. `feat-settings-dashboard`

Streams 2 and 7. **First**, because `SegmentedRow` and `ToggleRow` are consumed
by units 2 and 4; their API is frozen here or it is edited three times.

## 2. `feat-image-handling`

Streams 3 and 5. Carries a decision the vault depends on: **link mode versus
portability**. A linked image lives outside the vault by definition. Decided
here, because unit 7 encodes the answer and changing it later migrates user data.

## 3. `feat-in-app-feedback`

Stream 6. The only 0.9.0 feature that reaches outside the app. Carries the
question of where the local copy lives and what prunes it.

## 4. `feat-editor-settings-and-fixes`

Streams 4 and 8. Smallest. Exists as its own unit mainly because the caret/undo
isolation fix has **no regression test**: the `undo` coverage is workspace
undo, the `caret` coverage is fold behavior.

Streams 9 (Linux) and 10 (bump-version guard) are finished by every measure
checked; they need a changelog line at release, not a unit.

## 5. Cut 0.9.0

Mechanical once units 1-4 are done.

- [x] `npm run bump 0.9.0`: all five manifests bumped
- [x] Changelog: date `[0.9.0]`, and correct every entry to what shipped
- [ ] Merge to `main`, tag `v0.9.0`

**By decision (2026-09-19), unit 7 (vault serializer and export, stage 1 of
`feat-portable-vault-sync`) landed on `0.9.0-pre` ahead of this cut**, out of
the order this file states below. The insertion rule's reasoning for unit
7's position (§"Insertion rule": persisted-shape changes go before it) still
holds; what changed is that it now ships as part of 0.9.0 rather than
waiting for units 5-6 to close first. See `feat-portable-vault-sync/tasks.md`
for what stage 1 actually covers and the drift it records against this file
(migration numbering, the Excalidraw sidecar being inapplicable until unit
12). Units 5-6 below still gate on 1-4, not on unit 7.

**By decision (2026-09-22), unit 8 (dual-write, stage 2) also landed on
`0.9.0-pre`**, on top of unit 7 and before this cut. See unit 8.

## 6. Dependency baseline

Dependabot's three grouped PRs were closed on 2026-09-25 rather than merged, so
the groups regenerate against `main` after `v0.9.0`. Each was addressed on its
own terms:

- **cargo (#52): superseded.** Both manifest bumps in the group, rusqlite
  0.32->0.40 and window-vibrancy 0.6->0.8, shipped in 0.9.0 as part of
  `6197b97`, leaving only `Cargo.lock` churn against a base that had moved.
- **npm (#53): deferred, and stale.** It predates the whiteboard and updater
  work and proposed `@tauri-apps/plugin-updater` ^2.11.0 where 0.9.0 already
  carries 2.12.0. The majors are the real unit: vite 6->8, vitest 3->4,
  typescript 5.6->7.0, vite-plugin-svelte 5->7, jsdom 29->30, jest-dom 6->7,
  `@types/node` 25->26.
- **github-actions (#43): deferred, and it gates the release.** Not "CI only",
  as this file previously said: `tauri-apps/tauri-action` v0->v1 is a major bump
  of the action that builds and publishes the release artifacts, and
  `dtolnay/rust-toolchain` 1.91.1->1.100.0 moves the compiler. Also
  `actions/checkout` and `actions/setup-node` v4->v7.

rusqlite 0.32->0.40 was why this unit sat before units 7 through 9: it changes
the API `store.rs` is written against. That bump is in 0.9.0 now, so what is
left here is the npm majors and the workflow actions. Take them as separate
units.

**Done when** the suite passes on the new toolchain and a release bundle builds
on every supported platform, which is also the only thing that can prove
tauri-action v1 and the newer compiler.

## 7. Vault serializer and export (DONE, shipped in 0.9.0; see §5)

`feat-portable-vault-sync` stage 1. Pure addition; SQLite stays authoritative.

**Done when** exporting the full library and re-parsing it reproduces every
field of every note, and the exported folder reads correctly in a plain Markdown
editor.

## 8. Dual-write (BUILT, shipped in 0.9.0; see §5)

Stage 2. The last point at which the vault can be wrong for free. The
verification command is the unit's real output.

**Done when** it reports zero divergence across a real library after sustained
ordinary use. Not yet met: "Check vault" reports zero divergence on a copy of
the maintainer's library right after a full mirror, which proves the format and
the flush but not sustained use. Close this once the mirror has run on a real
library for a while and Check vault still comes back clean.

Building it surfaced a schema collision. Pre-release builds carrying the
whiteboard had migrated real libraries to v4 (`content_kind`, `surface_data`),
and `0.9.0-pre`, with the whiteboard lifted off, refused those libraries as
too new. The whiteboard's v4 now ships in 0.9.0 exactly as it was written,
columns only, and the vault is v5, as `design.md` §5 always said. See
`feat-portable-vault-sync/tasks.md`.

## 9. Filesystem authoritative

Stage 3. Carries the data-loss risk, which is why units 7 and 8 precede it.

**Cuts 0.10.0.** Portability with no sync: notes readable without the app,
backup by folder copy, folder-sync tools work by construction.

## 10. Git transport

Stage 4. **Cuts 0.11.0.** Split from unit 9 so that if the vault runs long,
portability has already shipped and only sync slips.

## 11. Attachment garbage collection (DONE, shipped in 0.9.0)

Landed on `0.9.0-pre` on 2026-09-22, ahead of unit 9, by decision: every
reference already lives in SQLite (note bodies, whiteboard canvases, the
capture draft), so the defect did not need the vault's view to be fixed.
Destroying notes removes the images only they used, and Settings > Images
clears what older versions left behind. See
`changes/archive/feat-attachment-cleanup/tasks.md`.

## 12. Whiteboard surface (DONE, shipped in 0.9.0)

Returned from `feat/note-whiteboard` onto `0.9.0-pre` on 2026-09-22, after vault
stages 1 and 2, the order this unit asked for: the canvas file is additive to
a vault format that already existed. The engine is Excalidraw, chosen for its
open file format. The four defects found on the branch (silent canvas loss on
unmount and quit, a dead engine abstraction, a hardcoded dark theme, and
searchable text hidden by convert) are each fixed or designed away; see
`changes/archive/feat-note-whiteboard/tasks.md`. Migration v6 carries boards
through the vault mirror. `feat/note-whiteboard` was deleted on
2026-09-25, after confirming 0.9.0 carries the better implementation: 27
frontend tests and 4 Rust tests (round trip, the v4 migration, v6 vault
tracking, canvas images), Excalidraw fonts bundled at `predev`/`prebuild`, and
`docs/DATA_MODEL.md` section 3.1 documenting the envelope. The branch's
`ARCHITECTURE.md` described files 0.9.0 deliberately dropped, and its
`registry.ts` was the dead engine abstraction this unit designed away.

## 13. Graph (DONE, shipped in 0.9.0)

Consumes note state and adds none: `library_graph` derives notes, tags, Spaces,
and their memberships from the existing tables on every read, and the layout
is computed in the view from positions seeded by id. Nothing is stored,
positions included, so the insertion rule does not move it. Landed on
`0.9.0-pre` on 2026-09-22. Edges are tags and Spaces only, by decision; links
between notes would be a body syntax (and a vault concern), and are not part
of this unit. See `changes/archive/feat-graph-view/tasks.md`.

## 13a. Update notification (DONE, shipped in 0.9.0)

`feat-update-notification`. View only: it renders the updater's state and stores
nothing, so the insertion rule puts it in any slot between units; it took its
own. An available update is a synthetic Space rather than a modal - two notes
carrying the version pair, the size delta read from the GitHub release assets,
the install button, and the release notes. Nothing is written to SQLite or the
vault, so the notification cannot be searched, tagged, filed, exported, or left
behind, and it disappears with the update. "Remind me later" is gone by
decision: the notification carries no timer and is answered by updating or
ignored by doing nothing. Landed on `0.9.0-pre` on 2026-09-24. See
`changes/archive/feat-update-notification/tasks.md`.

## 13b. `chore-boundary-registries` (DONE, shipped in 0.9.0)

Error codes and event names each get one registry per language, and one test
that holds the two sides equal (`src/lib/api/contract.test.ts`). Adds no
persisted state and does not touch the store API, so the insertion rule puts it
in any slot; it took its own. From `docs/CODE_SMELL_AUDIT.md` (2026-09-25),
phases 0-4 and 6; branded id types (phase 5) and collapsing the two-file IPC
command surface are deliberately not part of it. Landed on `0.9.0-pre` on
2026-09-25. See `changes/archive/chore-boundary-registries/tasks.md`.

## 13c. Sticky notes (BUILT, open until checked in the app)

`feat-sticky-notes`. A note pops out of the library into its own window that
floats, sits like any window, or lies on the desktop, and pops back in. Which
notes are stickies and where they sit is per-device window state in the
existing settings table (`stickies`), the same kind of row as a UI preference:
no note shape changes, nothing reaches the vault, and no write path moves, so
it is placed like a settings page on the key/value table, in any slot; it took
its own. A sticky is its note's only editor in the app while it is out; an
agent's write (13d) reaches it the same way it reaches the library's open
note. Built on `0.9.0-pre` on 2026-09-30 with its
tests green; it stays open until the in-app checks in
`changes/feat-sticky-notes/tasks.md` pass, then archives.

## 13d. `feat-agent-access` (BUILT, open until checked in the app)

Agents connect over MCP through the app's own binary (`instantnotes mcp`).
The insertion rule places it anywhere: no migration, no change to note shape,
and it reaches the library only through `Store`'s public API, so unit 9's
write-path rewrite sits beneath it rather than under it. The one store API
change is additive (`update_note`'s optional version check). Built in its own
worktree while the sticky-notes unit was in flight, then rebased onto it and
landed on `0.9.0-pre` on 2026-09-30. It precedes unit 14 on purpose: local AI
adds one tool to this surface instead of inventing its own. See
`changes/feat-agent-access/`.

## 14. Local AI

Needs embedding storage, so it cannot precede unit 10. Embeddings are a
rebuildable cache artifact and belong beside `instantnotes.db`, never in the
vault, a distinction the vault establishes. Graph precedes it because a graph
gives local AI somewhere to surface results.

---

## Branch model

A `<version>-pre` branch collects a release, `feat/*` branches merge into it, the
release merges to `main` and is tagged. One unit per branch, in general: the
vault units past stage 1 should still get their own `-pre` branch rather than
sharing one with unrelated feature work, since that separation is what makes
the working rule enforceable rather than aspirational. Units 7 and 8 (stages 1
and 2) are the recorded exceptions, landed on `0.9.0-pre` by decision (§5).
Stage 1 is pure addition. Stage 2 adds a second write path, but SQLite stays
authoritative and nothing reads the vault back, so the worst a stage 2 bug can
do is write a wrong file, which Check vault reports. Stages 3 and 4 flip
authority to the filesystem and must get their own `-pre` branch.

## Safety refs

Both were deleted on 2026-09-25, once 0.9.0 was confirmed to carry every piece
of work they held:

- `feat/note-whiteboard`: the pre-release whiteboard work, superseded by unit 12,
  which returned it with its four defects fixed.
- `backup/0.9.0-pre-with-whiteboard`: `0.9.0-pre` as it stood before the lift.
  Its nine commits are all represented on `0.9.0-pre`: the five whiteboard
  commits by unit 12, the Linux fix by `ffb7f90`, the bump-version guard by
  `dff86b6`, and the sequence and vault design docs by the files themselves.

`v0.8.0`, and the `v0.9.0` tag when it is cut, are the rollback points now.
