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
- [ ] Every design decision it depends on is **decided**, not deferred — a
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

Anything not listed below takes its position from one question — where does it
touch persistence?

- **Changes the shape of persisted note state, or the API the store is written
  against** -> before unit 7. The vault serializer encodes that shape; changing
  it afterwards means writing the format twice.
- **Adds persisted state without changing note shape** -> after unit 9.
  Units 7 through 9 rewrite the store's write path, and anything built against
  the old one gets built again.
- **View only** — theming, editor behavior, palette, layout, list rendering,
  settings pages on the existing key/value table -> any slot between units. It
  takes a slot of its own; it does not run alongside an open unit.

---

## 0. Branch hygiene — DONE

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
      no published history was rewritten and no force-push is needed. Preserved
      on `feat/note-whiteboard`; the pre-lift state is on
      `backup/0.9.0-pre-with-whiteboard`. This removed migration v4, the
      `react`/`react-dom`/`@excalidraw` runtime deps, and four defects from the
      release. See unit 12
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
isolation fix has **no regression test** — the `undo` coverage is workspace
undo, the `caret` coverage is fold behavior.

Streams 9 (Linux) and 10 (bump-version guard) are finished by every measure
checked; they need a changelog line at release, not a unit.

## 5. Cut 0.9.0

Mechanical once units 1-4 are done.

- [ ] `npm run bump 0.9.0` — all five manifests still read `0.8.0`
- [ ] Changelog: date `[0.9.0]`, and correct every entry to what shipped. The
      current section is a draft written ahead of the work
- [ ] Merge to `main`, tag `v0.9.0`

## 6. Dependency baseline

The three dependabot branches, rebased onto `main` after `v0.9.0`. Not merged
into 0.9.0: all three branch from `main` before the whiteboard work and carry a
stale `package.json`.

Not routine patches — npm: vite 6->8, vitest 3->4, typescript 5.6->7.0,
vite-plugin-svelte 5->7, jsdom 29->30, jest-dom 6->7, `@types/node` 25->26.
cargo: rusqlite 0.32->0.40, window-vibrancy 0.6->0.8. github-actions: CI only.

**Here, and not later, because rusqlite 0.32->0.40 changes the API `store.rs` is
written against**, and units 7 through 9 rewrite that file. Take cargo and npm
as separate units.

**Done when** the suite passes on the new toolchain and a release bundle builds
on every supported platform.

## 7. Vault serializer and export

`feat-portable-vault-sync` stage 1. Pure addition; SQLite stays authoritative.

**Done when** exporting the full library and re-parsing it reproduces every
field of every note, and the exported folder reads correctly in a plain Markdown
editor.

## 8. Dual-write

Stage 2. The last point at which the vault can be wrong for free. The
verification command is the unit's real output.

**Done when** it reports zero divergence across a real library after sustained
ordinary use.

## 9. Filesystem authoritative

Stage 3. Carries the data-loss risk, which is why units 7 and 8 precede it.

**Cuts 0.10.0.** Portability with no sync: notes readable without the app,
backup by folder copy, folder-sync tools work by construction.

## 10. Git transport

Stage 4. **Cuts 0.11.0.** Split from unit 9 so that if the vault runs long,
portability has already shipped and only sync slips.

## 11. Attachment garbage collection

Nothing removes an image when the last note referencing it is destroyed.
`feat-portable-vault-sync/design.md` section 14. After unit 9 every reference and
every file is visible in one place. Defects go before features.

## 12. Whiteboard surface

Returns from `feat/note-whiteboard`.

**Here, not earlier, because the ordering makes it cheaper.** Landing after the
vault means the whiteboard sidecar is a new file type added to a format with no
legacy data — additive. Landing before means the vault serializes an engine
format that is not chosen, and changing the engine later migrates user data on
disk *and* in SQLite.

The engine decision is still open. Svelte Flow was wired, then swapped for
Excalidraw; neither was chosen.

Four defects found on the branch, to fix or design away when it resumes:

1. **Silent canvas data loss.** `ExcalidrawCanvas.svelte` clears its 400 ms save
   timer in `disposeRootOnly()` without firing it — on unmount, note switch, and
   quit. The quit path flushes `library.flushPendingEdits()`, which this timer is
   not part of. Contradicts the 0.8.0 promise that quitting cannot lose the last
   moments of typing
2. **Dead engine abstraction.** `registry.ts` and three interfaces in `types.ts`
   have zero callers. Reads as though engine-swapping is supported; nothing
   implements it
3. **Theme ignored.** `theme: "dark"` hardcoded while the app ships six themes
4. **Convert semantics contradict the dialog.** The confirm warns the written
   body is lost. It is not — it stays in the row and stays FTS-indexed, just
   invisible. Search can land on a whiteboard for text that cannot be seen.
   `f806b6f`, despite its subject, changed only the list preview

## 13. Graph

Consumes note state and adds none, provided it is derived at read time. Storing
edges or node positions makes it persistence work and moves it by the insertion
rule. Keep it derived.

## 14. Local AI

Needs embedding storage, so it cannot precede unit 10. Embeddings are a
rebuildable cache artifact and belong beside `instantnotes.db`, never in the
vault — a distinction the vault establishes. Graph precedes it because a graph
gives local AI somewhere to surface results.

---

## Branch model

A `<version>-pre` branch collects a release, `feat/*` branches merge into it, the
release merges to `main` and is tagged. One unit per branch. The vault units get
their own `-pre` branch rather than sharing one with feature work, which is what
makes the working rule enforceable rather than aspirational.

## Safety refs

- `feat/note-whiteboard` — the whiteboard work, intact
- `backup/0.9.0-pre-with-whiteboard` — `0.9.0-pre` as it stood before the lift
