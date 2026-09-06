# Tasks: Settings Dashboard

Streams 2 and 7 of the ten identified on `0.9.0-pre`. The code exists; these are
the gaps between it and the definition of done in `openspec/SEQUENCE.md`.

## Freeze the primitives first

Everything below and three other units depend on these.

- [x] Review `SegmentedRow.svelte` (81 lines) and `ToggleRow.svelte` (79 lines)
      props: settle names, required vs optional, disabled and error states
- [x] Decide whether presentational-only components need tests here. If yes, add
      them; if no, record the reasoning so the next unit does not relitigate it
- [x] Confirm keyboard and screen-reader behavior on both (they replace native
      controls in every settings page)

### The frozen API

Both rows: `label` (required), `sub` (optional), `disabled` (optional, default
false), `onchange` (required). `SegmentedRow` adds `options` and `value`;
`ToggleRow` adds `checked`.

`SegmentedRow` is generic over its value type, so `options`, `value` and
`onchange` agree at compile time and no caller casts. The three `as` casts at
the call sites are gone.

**No `error` state.** Nothing in settings validates anything, and an optional
prop is additive to add later but a breaking change to remove. A frozen
primitive should not carry API that no consumer uses. Add it with the first
row that actually needs to report an invalid value.

`sub` is wired to the control through `aria-describedby`, so the explanation a
sighted user reads is the one a screen reader announces.

### The row shell

The row layout, the label, the sub line and the disabled dimming were copied in
four files. They now live once in `PrefRow.svelte`, which `SegmentedRow` and
`ToggleRow` render through, and which the Images preview-height slider uses
directly. A new kind of row gets the layout by using it; no page restates it.

### Keyboard

`SegmentedRow` declared `role="radiogroup"` and did not behave like one: every
segment was a tab stop and the arrow keys did nothing. It is now a real radio
group: roving tabindex so the selected segment is the group's single tab stop,
arrows move the selection and wrap, Home and End jump to the ends, and focus
follows the selection. The keys are handled on the segments, not on the group,
because the segment is what holds focus.

Both rows gained a `:focus-visible` ring. Neither had one, and both replace a
native control that would have had one.

`disabled` is enforced in the handlers as well as through the attribute, so
"onchange never fires while disabled" is a property of the component rather
than of the host that dispatches the event.

### Tests

`src/lib/components/settings/rows.test.ts`, 14 tests. They stopped being
presentational the moment they carried keyboard logic, so they are tested
directly rather than through the pages. `SettingsView.test.ts` additionally
holds the migrated Links page to the shared rows and proves a change persists.

## Dashboard

- [ ] Verify every dashboard number against a library with archived, trashed,
      and pinned notes present at once. **Left for jam in the running app**: the
      seven counts are unit-tested in `core/src/store/stats.rs`, but agreement
      between those counts and what the sidebar shows is only observable live
- [x] Confirm the attachments count and size come from the filesystem, not the
      store, and behave when the attachments directory is missing
- [x] Confirm capture readiness renders when no measurement has been recorded

`shell/files.rs:241-258` reads the directory, not the store, and a missing or
unreadable one returns zeros so the rest of the dashboard still renders. Two
things worth knowing, now in `docs/API.md`: every regular top-level file counts,
image or not, and subdirectories are neither traversed nor counted.

`notes_active` is returned by the command and displayed nowhere; the Notes tile
shows `notes_total` with pinned and archived beneath it. Left in the contract as
an aggregate, not removed.

## Changelog view

- [x] Confirm `changelog.ts` handles a version heading with no date. 0.9.0 is
      currently undated and will be until release
- [x] Confirm behavior when the running version has no matching section

Both were already handled and are now held there by tests. `SettingsView:131`
drops the whole "What's new" block when no section matches, rather than showing
an empty one, and `:135` renders the date only when there is one. A further test
parses the real bundled `CHANGELOG.md` for the version in `package.json`, so
cutting a release with no changelog entry fails the suite instead of silently
emptying the dashboard.

## Contract and record

- [x] `docs/API.md`: document `library_stats` and its `LibraryStats` shape
- [x] `CHANGELOG.md`: entry describing the dashboard as it actually shipped
- [ ] `cargo test`, `npm test`, `npm run check` pass
- [ ] Move this change to `openspec/changes/archive/`
