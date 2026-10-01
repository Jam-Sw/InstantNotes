# Tasks: In-App Feedback

Stream 6 of the ten identified on `0.9.0-pre`.

## Decide first

- [x] Where the local feedback copy lives, and whether anything prunes it
- [x] Confirm no note content is added automatically — the Privacy By Default
      requirement in `openspec/specs/instantnotes/spec.md` applies

### The decision: `<app data>/feedback.jsonl`, appended forever, revealed not pruned

Location is unchanged: `<app data>/feedback.jsonl`, one JSON object per line,
append-only. That part was already right.

No pruning. Each line is a category, a trimmed message, and four short
diagnostics fields — bytes, not megabytes. A thousand submissions is still
under a few hundred KB, and nothing about this app's usage pattern produces
thousands of feedback submissions. Pruning would be solving a problem this
file cannot reach at any realistic scale. (Attachments needed exactly the
opposite answer in `feat-image-handling` because images are not bytes, they
are megabytes; the two aren't analogous.)

The real gap was the other half of "grows without bound and nothing surfaces
it to the user" — not the growth, the invisibility. `SettingsFeedback.svelte`
had no way to see what had accumulated, unlike the Images page's "Open
attachments folder". Added `open_feedback_log` (`commands/feedback.rs`),
mirroring `open_attachments_folder`: reveals the file in the OS file manager
rather than opening it, since it's meant to be located, not edited, and
creates an empty file first if none exists yet so there is always something to
reveal. A "Reveal saved feedback" button and a line stating the file is never
pruned automatically now sit next to Send.

Privacy: confirmed by reading `FeedbackDiagnostics`
(`src/lib/feedback.ts`) — exactly `appVersion`, `platform`, `notes` (a count),
`attachments` (a count). No note title, body, tag, or Space name is in reach
of this code path. What a user pastes into the message box by hand is their
own choice, per the proposal; the app adds nothing on top of it. No gap found.

## The page

- [x] Test `SettingsFeedback.svelte` (185 lines, currently untested): category
      switch, empty-body rejection, submit success, submit failure.
      `SettingsFeedback.test.ts` (8 tests)
- [x] Confirm submitting works when the GitHub hand-off fails or no browser
      opens — the local copy must still be written. It was already written
      first, but a GitHub-only failure surfaced as "Couldn't send feedback",
      which is wrong: the feedback *was* sent, only the browser hand-off
      failed. `send()` now treats the two failures separately — a local-save
      failure keeps the draft and reports the error; a hand-off-only failure
      still clears the draft and reports "Saved locally, but couldn't open
      GitHub automatically." Covered by two tests in `SettingsFeedback.test.ts`
- [x] Confirm a very long body does not break the prefilled URL. It wasn't
      confirmed, it was false: only the title was capped (`.slice(0, 60)`),
      the body had no limit, and `open_url` hands the result to the OS shell,
      whose length tolerance is tighter than a browser address bar in some
      environments. `githubIssueUrl` now truncates the message past 1500
      characters with a note that the full text is saved locally; the
      diagnostics block is never truncated, since it's always short. Covered
      by three tests in `feedback.test.ts`

## Contract and record

- [x] `docs/API.md`: document `submit_feedback` and its `FeedbackInput` shape,
      and `open_feedback_log`
- [x] `CHANGELOG.md`: entry for the Feedback page
- [x] `cargo test`, `npm test`, `npm run check` pass — 92 Rust tests,
      350 frontend tests (up from 339), 0 type errors across 493 files
- [x] Move this change to `openspec/changes/archive/`
