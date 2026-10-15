# Design: One experience across devices (shared)

The rules every unit in this change follows, and the owner's decisions. Each
unit's own design is in `<unit>/design.md`.

## 1. The two homes rule

Every action a person can take lives in exactly two places, the two that
every device has:

- **Settings** holds what you set or check: updates, sync, backups,
  diagnostics, appearance, the editor. A thing you check has a page; a thing
  you set has a row on a page.
- **The command palette** holds what you do: new note, capture, check for
  updates, back up now, export, send diagnostics, open on another device.
  On a device with a keyboard it opens with the palette shortcut; on a touch
  device a button opens it.

The desktop app menu (File, Edit, View, Help) and the tray menu are shortcuts
to those commands and nothing else. A menu item carries the id of a palette
command; the shell announces it with one event, `menu:command { id }`, and the
front end runs the command from the same registry the palette uses. No menu
item does anything a palette command cannot, so a phone or a tablet, which
have neither menus nor a tray, lose nothing.

A corollary: every new feature in this change adds its palette command and its
Settings home in the same commit as the feature.

## 2. Names

- Change folder: `openspec/changes/feat-one-experience/`, one folder per unit
  under it, each with `design.md` and `tasks.md`.
- Settings keys added: `backups.automatic` (bool, default true),
  `diagnostics.crashReports` (bool, default false), `updates.lastCheckedAt`
  (ISO string), `editor.sourceMode` (bool, default false; replaces the
  meaning `editor.toolbarOpen` had, which stays as the toolbar's visibility).
- Events added: `menu:command { id }`, `backups:changed`. Removed:
  `settings:open`, `menu:new-note`, `menu:new-whiteboard`, `menu:new-sheet`,
  `menu:export-note`, `menu:toggle-sticky`, `updater:check`.
- Commands added to `src/lib/commands.ts`: `view.settings`, `app.checkUpdates`,
  `app.showUpdate`, `app.sendFeedback`, `app.sendDiagnostics`, `app.openRepo`,
  `app.openDataFolder`, `app.quit`, `data.backupNow`, `data.export`,
  `data.backups`, `note.export`, `note.openElsewhere`, `view.palette`,
  `view.zoomIn`, `view.zoomOut`, `view.zoomReset`.
- Files beside the library (`<app data>/`): `backups/`, `crashes/`,
  `instantnotes.log` (and `.1`), `instantnotes.db.restore`.
- Server: `INSTANTNOTES_PEOPLE_DIR`; subcommands `usage`, `check`.

## 3. What every unit proves

- Unit tests beside every change (vitest, cargo test), the full
  check green, `cargo xwin check` for Windows, the
  WebAssembly check for the browser.
- Anything visual: screenshots at desktop width, and from `mobile` on, at
  390x844, 820x1180 and 1180x820, taken from the real web app against a
  throwaway server image.
- Anything touching sync or the shell: the end-to-end script and the in-app
  proof script.
- The workflow: actionlint, and a rehearsal run the owner can make on the
  branch before merging (`release-chain/design.md` §5).

## 4. Decisions

Recorded with the date. "Approved to build" means the owner's instruction of
2026-10-13 to proceed on the branch covers it; it is still his to change at
review.

### D1. Signing accounts (open; owner)

Developer ID signing and notarization need the Apple Developer Program
(99 USD a year). Windows signing needs Azure Trusted Signing (about 10 USD a
month, needs an Azure account and an identity validation) or a certificate
from a CA. Recommendation: Apple Developer Program, and Azure Trusted Signing
for Windows, because it is the cheapest route to a Microsoft-trusted
signature, it needs no hardware token, and GitHub's Windows runner signs with
it through an official action. The pipeline is built so that nothing changes
until the secrets exist (`signed-installs/design.md`).

### D2. Hosted runners (approved to build 2026-10-13; owner confirms at review)

The three installers and the image build on GitHub-hosted runners
(`ubuntu-22.04`, `windows-latest`, `macos-latest`), free for a public
repository. Rejected: a second self-hosted runner (another machine to keep
up, and the signing tools for Windows and macOS do not run on Linux). The
self-hosted runner and the Mac builder are no longer part of the release;
Local smoke builds keep using them.

### D3. Sync for people without a server (open; owner)

`sync-without-a-server/design.md` lays out three options and recommends a
Jam-Sw hosted sync service, which with end-to-end encryption reads nothing,
reusing the server image as it is behind an identity provider the owner
runs; the app needs one preset address. Nothing is built until he decides.

### D4. Native iOS and iPadOS (open; owner)

Needs Xcode on the Mac and the Apple Developer Program. The plan is in
`mobile/design.md` §6; the phone and tablet layouts ship now in the web app
and do not wait for it.

### D5. The toolbar shown by default (approved to build 2026-10-13)

The reference image (owner, 13 Oct) shows a toolbar above a rich editor. The
toolbar becomes visible by default and no longer switches the editor into
Markdown source view; a Markdown source toggle lives on the toolbar. Someone
who hid the toolbar before keeps it hidden (the stored `editor.toolbarOpen`
is respected when it exists).

### D6. Restore turns sync off (approved to build 2026-10-13)

A restored library carries an older sync position; left on, the next cycle
would pull the server's newer changes back over it, undoing the restore.
Restore therefore detaches sync (folder or server) and the person turns it
back on when ready, which runs the join flow of 0.10.0 and keeps everything.
Said plainly on the Backups page before the restore and after it.

### D7. Crash reports are written locally always, sent only by hand (approved to build 2026-10-13)

The opt-in switch gates the prompt after a crash, not the local file: a report
on disk costs nothing and is what Send diagnostics shows. Sending is always
the person opening a prefilled GitHub issue in their own browser, as feedback
already works; there is no telemetry endpoint and none is added.

### D8. Per-person folders by template (approved to build 2026-10-13)

`INSTANTNOTES_PEOPLE_DIR` with `{sub}`, `{username}` and `{email}`
placeholders. Unset, the layout stays `<data>/sync/<folder_name(sub)>`, so
every 0.10.0 deployment is unchanged. Set, a person's existing folder under
the old layout is moved to the new path on their next request, once, logged.

### D9. Usage and the headless check as subcommands, not endpoints (approved to build 2026-10-13)

`instantnotes-server usage` and `instantnotes-server check` run inside the
container with the data folder, so no admin token exists to leak and no
endpoint widens the attack surface. The check mints its own five-minute
device token for a reserved check person and removes everything it made.

### D10. Order (approved to build 2026-10-13)

`proposal.md` §Order.
