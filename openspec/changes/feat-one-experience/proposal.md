# Change: One experience across devices, built to last (0.10.1)

## Why

0.10.0 made one library reachable from every device: folder sync, and a
self-hosted sync server with end-to-end encryption, from the desktop apps and
any browser. What a person meets on those devices is still three different
apps: a desktop app with a menu bar and a tray icon, a browser tab that is the
desktop layout squeezed onto a phone, and a whiteboard that assumes a mouse.
Under them, the foundations a notes app is trusted on are missing: there is
no automatic backup, no restore, no way to say what went wrong, the installers
are unsigned, and the release runs on one PC.

The owner's brief for this update (13 Oct): "really about utility and the
user experience across devices, making it feel cohesive and making our
services in InstantNotes powerful, for the everyday, for free", and "no trust
release, we do it right the first time so even 200 versions later, it's still
going strong".

This change is that update, planned as one set so the pieces agree with each
other: one rule for where every action lives, one writing surface, the data
safety and diagnostics every device shares, the server an operator can run for
a school or a family, signed installs from a release chain that is not tied to
one machine, and then the phone, the tablet and the pen.

## What Changes

- **The package and the repository say what they are** (`metadata`): OCI labels
  on the server image, so the GHCR page shows a description and links to the
  repository; the repository's About line and topics.
- **Every action has two homes** (`actions`): Settings for what you set or
  check, the command palette for what you do. The desktop menus and the tray
  become shortcuts to the same commands through one `menu:command` event; a
  View and a Help menu appear. Settings > About gets the installed version, the
  platform, the last check, Check for updates and Show update; a found update
  announces itself with a toast that stays until answered.
- **The writing surface** (`writing`): the editor pane redrawn from the owner's
  reference: one icon toolbar in one row (undo, redo, heading, bold, italic,
  strikethrough, code, quote, lists, link, image, Markdown source, zoom), a
  filled active state, shown by default and decoupled from the Markdown source
  view; tighter spacing between title, labels and body. Typography stays ours.
- **Data safety** (`data-safety`): daily automatic backups of the library,
  kept by a seven-day, five-week, six-month rule; Back up now; Restore from a
  backup or from a file, through a marker applied at the next launch, never on
  an open library; Export everything as Markdown on every platform (a folder on
  the desktop, a `.zip` download in the browser).
- **Diagnostics** (`diagnostics`): a panic hook and a front-end error hook that
  write reports beside the library; an opt-in prompt after a crash; Send
  diagnostics, which shows the whole report before it goes anywhere, and sends
  it the way feedback goes, through the person's own browser to a GitHub
  issue. Nothing leaves the machine without a click. A small rotating app log.
- **The server for operators** (`server-operators`): a per-person data folder
  template (`INSTANTNOTES_PEOPLE_DIR`), `instantnotes-server usage` for
  per-person bytes and objects, `instantnotes-server check` as a headless
  end-to-end proof of the sync path, the read-only root filesystem documented
  with the writable paths, a multi-arch image (amd64 and arm64), and the rule
  that every new or renamed variable is named in the CHANGELOG.
- **Signed installs** (`signed-installs`): Developer ID signing and
  notarization on macOS, Azure Trusted Signing on Windows, both switched on by
  secrets in the release workflow and unsigned until the owner adds them; the
  owner's exact steps.
- **A release chain not tied to one PC** (`release-chain`): the three
  installers and the image built on GitHub-hosted runners, the signing secrets
  where the signing tools run natively, the web app's file hashes published
  with each release. The self-hosted runner and the Mac builder are retired
  from the release and kept for local smoke builds.
- **Sync for people without a server** (`sync-without-a-server`): a decision
  record with the owner's options and a recommendation; no code until decided.
- **Mobile** (`mobile`): a phone layout (one pane at a time, the sidebar as a
  drawer, back buttons), a tablet layout, touch targets, safe areas, the
  on-screen keyboard, a palette button on touch; the desktop pixel-identical.
  Native iOS and iPadOS planned in the same unit, gated on the owner's Xcode
  and Apple Developer account.
- **The whiteboard** (`whiteboard`): Apple Pencil and touch (pressure, palm
  rejection, the pen tool first on touch), Open on another device (a QR code
  and a link that open the same board in the web app on the person's server),
  and the board sized for the phone and the tablet.

## Non-goals

- Real-time co-editing of one whiteboard between two people (a "session" in
  the live sense). The QR code opens the same synced board on another device.
- Handwriting recognition, PDF annotation and notebooks (the GoodNotes
  features beyond ink on a board).
- A hosted sync service run by Jam-Sw: decided, not built, in this change.
- Native iOS and iPadOS builds: planned and spiked only once the owner has
  Xcode and the Apple Developer Program.
- Rebuilding a lost database from the vault folder (unit 9 of SEQUENCE.md).
- Git sync (unit 10).

## Impact

- **Store**: no note column changes. New settings keys: `backups.automatic`,
  `diagnostics.crashReports`, `updates.lastCheckedAt`, `editor.sourceMode`.
  New files beside the library: `backups/`, `crashes/`, `instantnotes.log`,
  and the `instantnotes.db.restore` marker while a restore waits.
- **Core**: `vault::archive` (a stored `.zip` writer for the browser export),
  `backup` (names, verification, the keep rule, the pending restore),
  `Store::detach_sync` (the state a restore drops).
- **Shell**: `shell/backups.rs`, `shell/diagnostics.rs`, `shell/log.rs`, the
  menus rewritten around `menu:command`; events `menu:command`,
  `backups:changed` replace `settings:open`, `menu:*`, `updater:check`.
- **Web**: `export_archive` in the worker; `#note=<id>` opens a note; the
  phone and tablet layouts; a touch palette button.
- **Server**: `INSTANTNOTES_PEOPLE_DIR`, `INSTANTNOTES_ADMIN` is not added
  (usage is a CLI, not an endpoint); subcommands `usage` and `check`;
  `people.username` column in `server.db`.
- **Workflows**: `release.yml` moves to hosted runners with signing and the
  multi-arch image; `build.yml` unchanged.
- **Dependencies**: none new in the app. The server gains none. The
  Dockerfile gains the aarch64 cross toolchain in its build stage.
- **Docs**: `README.md` (self-hosting, signing, installing), `docs/API.md`,
  `docs/DATA_MODEL.md`, `CHANGELOG.md` `[0.10.1]`.

## Placement

`SEQUENCE.md`'s insertion rule puts persisted state after unit 9. This change
adds settings keys and files beside the library and changes no note shape;
recorded as an exception by the owner's instruction (13 Oct) to build it on
`0.10.1-pre`, as units 13c to 13k were. One branch, `0.10.1-pre`, one commit
per unit or per coherent step; the one-unit rule holds inside the branch:
units land in the order below, each with its tests green before the next.

## Order

Built in this order, which differs from the brief's list in two places: the
actions rule comes first because every later unit adds actions and needs the
homes to exist, and the writing surface comes before the foundations because
the owner named it the most important part (13 Oct, the reference image).

1. `metadata`
2. `actions`
3. `writing`
4. `data-safety`
5. `diagnostics`
6. `server-operators`
7. `signed-installs` and `release-chain` (one workflow change)
8. `sync-without-a-server` (decision only)
9. `mobile`
10. `whiteboard`

## Decisions for the owner

`design.md` §4. The owner's instruction of 13 Oct ("proceed, it is safe to
spike it to completion on the branch") approves building; each decision
below stays open for change at review, and the ones that need accounts or
money wait for him regardless: D1 signing accounts, D2 hosted runners, D3
sync without a server, D4 native iOS, D5 the toolbar shown by default.

## Carried over from 0.10.0

Recorded here with where each goes; the owner decides at review.

- The owner's real-device join (Linux and Mac libraries into one on his
  server): his step, after this change ships; not a task here.
- Sync checks covered by tests only (restore from the recovery key,
  encryption off and on, Review merge choices, editing offline in the
  browser): stay as they are; `data-safety` adds its own in-app checks.
- Not built: the recovery key's QR scan (waits; no camera API in Safari),
  the finished-join summary (waits), the sign-in background (waits), the
  published web-code hashes (built here, `release-chain`).
- The operator requirements relayed by the server-kel session (13 Oct):
  `server-operators`, in 0.10.1.

Design: `design.md` and each unit's `<unit>/design.md`. Tasks: `tasks.md`.
