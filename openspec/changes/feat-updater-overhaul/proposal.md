# Change: Robust, Transparent Self-Updater

## Why
The app already auto-updates from GitHub Releases, but two problems hurt the
~1000 installed users. First, after an in-place update macOS keeps showing the
icon it cached for the old build: the new bundle has the right icon, but
LaunchServices and `iconservicesd` are never told to re-read it, so the Dock,
Finder, and Launchpad show the stale icon (often until reboot). The new app icon
shipped in v0.5.2 did not visibly refresh for users who updated in place.

Second, the update was opaque. The only surface was a small pill that appeared
in one corner of the empty library state; check failures were swallowed
silently; there was no manual "check for updates"; and `latest.json`'s release
notes were a static "download the .dmg" blurb, so the update never told the user
what was actually changing or to which version.

A third, related risk: the release was built as a *draft*, so a forgotten
"Publish" click silently blocked delivery, and the four version files were bumped
by hand, which can drift.

## What Changes
- Refresh the macOS icon after an in-place update: on first launch of a new
  version (tracked by a `.last_version` marker beside the database), re-register
  the bundle with LaunchServices (`lsregister -f`), bump its mtime, and relaunch
  the Dock. No-op on the same-version happy path and in dev builds.
- Replace the cramped pill flow with an explicit update panel showing the
  current version, the target version, the release notes, and download progress,
  with surfaced (not swallowed) errors and retry. The pill becomes the entry
  point that opens the panel.
- Distinguish automatic from manual checks: automatic checks stay silent unless
  an update exists; a manual check - from a new "Check for Updates…" item in the
  tray Settings menu - reports "up to date" and errors too.
- Drive release notes from `CHANGELOG.md`: the section for the tag becomes the
  GitHub release body and `latest.json`'s `notes`, so the in-app "What's new" is
  real. A tagged release publishes on a successful build instead of waiting as a
  draft. `npm run bump <x.y.z>` keeps all four version files in lockstep.

## Impact
- Frontend: `src/lib/stores/updater.svelte.ts` (manual/auto, notes, versions,
  up-to-date/error states), new `src/lib/components/UpdatePanel.svelte`, and a
  small wiring change in `src/routes/+page.svelte`.
- Shell: `src-tauri/src/lib.rs` gains the icon-cache refresh and a tray
  "Check for Updates…" item that emits `updater:check`. `instantnotes-core` is
  untouched.
- Release: `.github/workflows/release.yml` (notes from CHANGELOG, publish on
  success), new `CHANGELOG.md`, new `scripts/bump-version.mjs`, README.
- The icon refresh runs `killall Dock` once per update (a brief Dock relaunch);
  it never touches the system-wide icon cache store.
