# Tasks: Settings Dashboard

Streams 2 and 7 of the ten identified on `0.9.0-pre`. The code exists; these are
the gaps between it and the definition of done in `openspec/SEQUENCE.md`.

## Freeze the primitives first

Everything below and three other units depend on these.

- [ ] Review `SegmentedRow.svelte` (81 lines) and `ToggleRow.svelte` (79 lines)
      props: settle names, required vs optional, disabled and error states
- [ ] Decide whether presentational-only components need tests here. If yes, add
      them; if no, record the reasoning so the next unit does not relitigate it
- [ ] Confirm keyboard and screen-reader behavior on both (they replace native
      controls in every settings page)

## Dashboard

- [ ] Verify every dashboard number against a library with archived, trashed,
      and pinned notes present at once
- [ ] Confirm the attachments count and size come from the filesystem, not the
      store, and behave when the attachments directory is missing
- [ ] Confirm capture readiness renders when no measurement has been recorded

## Changelog view

- [ ] Confirm `changelog.ts` handles a version heading with no date — 0.9.0 is
      currently undated and will be until release
- [ ] Confirm behavior when the running version has no matching section

## Contract and record

- [ ] `docs/API.md`: document `library_stats` and its `LibraryStats` shape
- [ ] `CHANGELOG.md`: entry describing the dashboard as it actually shipped
- [ ] `cargo test`, `npm test`, `npm run check` pass
- [ ] Move this change to `openspec/changes/archive/`
