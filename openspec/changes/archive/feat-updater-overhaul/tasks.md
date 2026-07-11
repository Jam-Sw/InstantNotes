# Tasks

- [x] Refresh the macOS icon cache once per version change (lsregister + touch + killall Dock), guarded to real .app bundles
- [x] Unit-test the icon-refresh decision (refresh when version differs or marker is missing)
- [x] Extend the updater store: notes, current/target version, manual vs automatic checks, up-to-date and error states, dismiss
- [x] Add UpdatePanel.svelte: current -> target version, release notes, progress bar, surfaced errors and retry
- [x] Make the update pill open the panel; mount the panel in the library window
- [x] Add a tray "Check for Updates…" item that opens the panel and runs a manual check via the updater:check event
- [x] Add scripts/bump-version.mjs to bump package.json, tauri.conf.json, Cargo.toml, and Cargo.lock in lockstep
- [x] Unit-test the version-rewrite helpers (top-level JSON key; named Cargo package, not deps or siblings)
- [x] Add CHANGELOG.md and source release notes from it in CI
- [x] Publish the release on a successful build instead of leaving a draft
- [x] Update the README release section for the bump script, changelog notes, and publish-on-build
