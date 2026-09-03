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

**Code on a branch is not evidence of any of this.** `0.9.0-pre` carries working
code for several features that are not decided, and a changelog section written
as though they were. Presence in the tree says the work started, nothing more.

## Insertion rule

Anything not listed below takes its position from one question — where does it
touch persistence?

- **Changes the shape of persisted note state, or the API the store is written
  against** → before unit 4. The vault serializer encodes that shape; changing
  it afterwards means writing the format twice.
- **Adds persisted state without changing note shape** → after unit 6.
  Units 4 through 6 rewrite the store's write path, and anything built against
  the old one gets built again.
- **View only** — theming, editor behavior, palette, layout, list rendering,
  settings pages on the existing key/value table → any slot between units. It
  takes a slot of its own; it does not run alongside an open unit.

---

## 0. Branch hygiene — PARTIAL

Only the parts that assert nothing about feature readiness are done.

- [x] Commit the Linux working-tree changes — `WEBKIT_DISABLE_DMABUF_RENDERER`
      in `src-tauri/src/main.rs` and `scripts/tauri-dev.mjs`, Arch/CachyOS notes
      in `README.md` (`28c22d0`). A self-contained fix. It does **not** make
      Linux a supported platform; `[0.7.0]` still calls Linux an early preview
      and that remains true
- [x] `openspec/specs/instantnotes/spec.md`: dropped the two references to the
      `version` column that migration v3 removed. A factual correction,
      independent of any feature's status
- [x] Dependabot — deferred to unit 3, not merged into 0.9.0
- [ ] Everything else waits on unit 1. The version bump, the changelog entries,
      the whiteboard requirement in the spec, Excalidraw in the tech stack, and
      the archive move are all statements that a feature is finished, and none
      of them can be made yet

## 1. Finish what 0.9.0 started

**This is the open unit.** `0.9.0-pre` holds working-but-unfinished code for
several features. Each is finished to the definition of done above, one at a
time, before 0.9.0 exists as a release.

The pre-existing `[0.9.0]` changelog section describes seven of these as
shipped. It was written ahead of the work; it is a draft, not a record, and each
entry is only true once its feature clears the checklist.

Every difference between `v0.8.0` and this branch is unfinished work: 67 files,
+6903/-1008, across ten independent streams. **Status is unconfirmed for every
row** — it needs deciding, never inferred from the diff.

| # | Stream | Surface | Known open question |
| --- | --- | --- | --- |
| 1 | Whiteboard surface | `src/lib/whiteboard/*`, `components/whiteboard/*`, **migration v4**, `types.rs`, `notes.rs`, NoteEditor, NoteList | **Backend undecided.** Svelte Flow wired, then swapped for Excalidraw. Neither is chosen. See 1a |
| 2 | Settings dashboard | `SettingsView.svelte` (+239), `core/stats.rs`, `commands/stats.rs`, `LibraryStats`, `changelog.ts` | ? |
| 3 | Images settings + insert from file | `SettingsImages.svelte` (210), `stores/images.svelte.ts`, `editor/images.ts`, `shell/files.rs` (+113) | ? |
| 4 | Editor settings page | `SettingsEditor.svelte`, `stores/editor.svelte.ts`, `format.ts` | ? |
| 5 | Contexting image modes | `contexting-format.ts` (+55), `stores/contexting.svelte.ts` | ? |
| 6 | In-app feedback | `SettingsFeedback.svelte` (185), `feedback.ts`, `commands/feedback.rs` | ? |
| 7 | Settings UI primitives | `SegmentedRow.svelte`, `ToggleRow.svelte` | Shared by 2-6; finishing those depends on these |
| 8 | Editor state fixes | `Editor.svelte` (97), `NoteEditor.svelte` (157), `links.ts`, `theme.ts` | ? |
| 9 | Linux support | `main.rs`, `tauri-dev.mjs`, `README.md` | Early preview per `[0.7.0]`. What makes it supported? |
| 10 | bump-version guard | `scripts/bump-version.mjs` | ? |

### The schema is already committed to an undecided design

Stream 1 carries **migration v4** — `content_kind` and `surface_data` on `notes`.
Migrations are one-way for users: once 0.9.0 releases, those columns are in every
database and `user_version` has advanced. If the engine changes after that, the
`surface_data` payloads already written need a data migration, not just new code.

That makes 1a a blocker on **releasing 0.9.0 at all**, not only on unit 4.

The branch also took `@excalidraw/excalidraw`, `react`, and `react-dom` as
runtime dependencies of a Svelte app — a heavy commitment to a backend that is
not chosen.

### 1a. Whiteboard backend decision

Called out separately because it blocks more than its own feature.

The engine choice determines the shape of `surface_data`, and unit 4 serializes
`surface_data` into a file format that then has to stay stable for every device
and every transport. **Unit 4 cannot start until this is decided.** Writing the
serializer against an undecided engine means writing it twice, and the second
time it is a migration of user data rather than an edit.

Deciding means: engine chosen, `surface_data` shape frozen, and convert
semantics settled — not "Excalidraw is what is currently wired up".

**Done when** every row above is either finished to the checklist or explicitly
cut from 0.9.0, the changelog describes only what is actually true, and the spec
carries requirements only for shipped behavior.

## 2. Cut 0.9.0

Bump, tag, release. Mechanical once unit 1 is genuinely done.

- [ ] `npm run bump 0.9.0` — all five manifests still read `0.8.0`
- [ ] Changelog: date `[0.9.0]`, and correct every entry to what shipped
- [ ] `openspec/project.md`: platform line and tech stack, reflecting what was
      actually decided in unit 1
- [ ] Archive the OpenSpec changes whose features finished
- [ ] Merge to `main`, tag `v0.9.0`

## 3. Dependency baseline

The three open dependabot branches, rebased onto `main` after `v0.9.0`.
**Not merged into 0.9.0**: all three branch from `main` before the whiteboard
work, so their `package.json` carries no `@excalidraw/excalidraw`, `react`, or
`react-dom`, and merging one reverts those while fighting a 2799-line lockfile.

They are not routine patches:

- npm: vite 6→8, vitest 3→4, typescript 5.6→7.0, vite-plugin-svelte 5→7,
  jsdom 29→30, jest-dom 6→7, `@types/node` 25→26
- cargo: rusqlite 0.32→0.40, window-vibrancy 0.6→0.8
- github-actions: CI only, safe

**Here, and not later, because rusqlite 0.32→0.40 changes the API `store.rs` is
written against**, and units 4 through 6 rewrite that same file. Taking the bump
afterwards means porting fresh vault code to an API that was about to change.
The npm half belongs here for a weaker but real reason: a TypeScript and Vitest
major during vault work makes it ambiguous which change broke a test.

Take cargo and npm as separate units. github-actions can ride with either.

**Done when** the full suite passes on the new toolchain and a release bundle
builds on every supported platform.

## 4. Vault serializer and export

`feat-portable-vault-sync` stage 1. Note ↔ Markdown with YAML frontmatter,
whiteboard sidecar, `instantnotes.yaml`, round-trip property tests, and a
one-way `export_vault` command.

**Blocked on 1a.** The sidecar format is the chosen engine's format; there is no
engine-neutral way to write it. Also blocked on image attachment handling from
unit 1 settling, for the same reason.

**Here because** it is otherwise pure addition. SQLite stays authoritative and
no existing write path is touched, so the format can be proven against a real
library before anything depends on it.

**Done when** exporting the full library and re-parsing it reproduces every
field of every note, verified by property tests, and the exported folder reads
correctly in a plain Markdown editor.

## 5. Dual-write

Stage 2. Migration v5, the dirty set, `flush_vault()`, filenames, trash moves,
and the DB-versus-vault verification command.

**Here because** it is the last point at which the vault can be wrong for free.
SQLite is still authoritative; the vault is written and never read. The
verification command is the unit's real output — it is what proves unit 6 safe.

**Done when** the verification command reports zero divergence across a real
library after sustained ordinary use.

## 6. Filesystem authoritative

Stage 3. The watcher, echo suppression, ingest, rebuild-from-disk, attachments
moving into the vault, and the one-time migration for existing installs.

**Here because** everything it depends on is now proven. This is the unit that
carries the data-loss risk, which is why the two units before it exist.

**Cuts 0.10.0.** Portability ships with no sync in it: notes readable without
the app, backup by folder copy, and any folder-sync tool works by construction.

**Done when** the cache can be deleted and rebuilt from disk with no
user-visible loss, and an edit made in an external editor appears in the app.

## 7. Git transport

Stage 4. Pull and push cadence, conflict copies, whiteboard element merge,
keychain token storage, sync status UI.

**Here because** it is additive on top of a stable write path. It is split from
unit 6 so that if the vault work runs long, portability has already shipped and
only sync slips.

**Cuts 0.11.0.**

**Done when** two machines converge on the same vault, and a deliberate
concurrent edit produces a conflict copy rather than a loss.

## 8. Attachment garbage collection

Nothing removes an image when the last note referencing it is destroyed. A
pre-existing defect; `feat-portable-vault-sync/design.md` §14.

**Here because** after unit 6 every reference and every file is visible in one
place, so the scanner is small and obviously correct. Written earlier it would
be written against the DB and then rewritten. It sits at the front of the
post-vault work because it is a known defect, and defects go before features.

## 9. Graph

From the Product Thesis: resurfacing is closure.

**Here because** it consumes note state and adds none, provided it is derived at
read time. It becomes persistence work the moment it stores edges or node
positions, which would move it behind the vault by the insertion rule. Keep it
derived.

## 10. Local AI

**Last of what is currently identified.** It needs embedding storage, so it is
persistence work and cannot precede unit 7. It also wants a decision the vault
already made: embeddings are a rebuildable cache artifact and belong beside
`instantnotes.db`, never in the vault. Building it earlier means making that
call without the distinction existing.

Graph precedes it because a graph gives local AI somewhere to surface results.

---

## Branch model

Unchanged. A `<version>-pre` branch collects a release, `feat/*` branches merge
into it, the release merges to `main` and is tagged. One unit per branch. The
vault units get their own `-pre` branch rather than sharing one with feature
work, which is what makes the working rule enforceable rather than aspirational.
