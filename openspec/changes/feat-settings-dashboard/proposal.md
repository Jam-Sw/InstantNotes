# Change: Settings Dashboard

## Why

The Settings front page was a bare list of category cards. It became a dashboard
showing live library counts, capture readiness, and the release notes for the
running version, so Settings answers "what is in here and what changed" without
leaving the app.

The code is written and works. This change is the remaining distance to done.

## What Changes

Already built on `0.9.0-pre` (`44bea94`):

- `library_stats` IPC command over `core/src/store/stats.rs` — one query per
  number, unit-tested across all seven counts
- `changelog.ts` — a pure parser for the bundled `CHANGELOG.md`, so "what's new"
  needs no network call (the webview CSP blocks external fetches). 5 tests
- `SettingsView.svelte` dashboard layout. 4 tests
- Shared settings primitives `SegmentedRow.svelte` and `ToggleRow.svelte`

## Remaining to done

- `library_stats` is undocumented in `docs/API.md`
- The two primitives have no tests and no frozen API, and every other settings
  page depends on them
- No changelog entry yet describes this accurately

## Non-goals

- No new stats. The seven counts plus attachments are the set
- No redesign of the category grid below the dashboard

## Sequencing

**First of the four 0.9.0 units**, because `SegmentedRow` and `ToggleRow` are
consumed by `feat-image-handling`, `feat-in-app-feedback`, and
`feat-editor-settings-and-fixes`. Their API is frozen here; changing it later
edits three other units.

## Impact

Settings gains a front page worth opening. `library_stats` is the first IPC
command that aggregates across the whole store, and the shape it settles on is
what a future graph or dashboard reads.
