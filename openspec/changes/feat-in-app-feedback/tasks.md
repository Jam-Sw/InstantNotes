# Tasks: In-App Feedback

Stream 6 of the ten identified on `0.9.0-pre`.

## Decide first

- [ ] Where the local feedback copy lives, and whether anything prunes it
- [ ] Confirm no note content is added automatically — the Privacy By Default
      requirement in `openspec/specs/instantnotes/spec.md` applies

## The page

- [ ] Test `SettingsFeedback.svelte` (185 lines, currently untested): category
      switch, empty-body rejection, submit success, submit failure
- [ ] Confirm submitting works when the GitHub hand-off fails or no browser
      opens — the local copy must still be written
- [ ] Confirm a very long body does not break the prefilled URL

## Contract and record

- [ ] `docs/API.md`: document `submit_feedback` and its `FeedbackInput` shape
- [ ] `CHANGELOG.md`: entry for the Feedback page
- [ ] `cargo test`, `npm test`, `npm run check` pass
- [ ] Move this change to `openspec/changes/archive/`
