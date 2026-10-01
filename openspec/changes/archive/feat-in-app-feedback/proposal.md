# Change: In-App Feedback

## Why

Reporting a bug meant leaving the app and writing an issue by hand. The Feedback
page files a bug or an idea from inside InstantNotes, keeps a copy on the user's
machine, and opens a prefilled GitHub issue.

The code is written and works. This change is the remaining distance to done.

## What Changes

Already built on `0.9.0-pre` (`44bea94`):

- `SettingsFeedback.svelte` — category (bug or idea), body, submit
- `submit_feedback` IPC over `commands/feedback.rs`, appending a local copy
- The GitHub hand-off runs on the frontend through `open_url`, so the Rust side
  never talks to the network
- `feedback.test.ts` (4 tests)

## Remaining to done

- `SettingsFeedback.svelte` is 185 lines with no test
- `submit_feedback` is undocumented in `docs/API.md`
- Two open questions, below

## Open questions

1. **Where the local copy lives, and for how long.** Nothing prunes it today.
   It grows without bound and nothing surfaces it to the user
2. **Whether note content can reach it.** `openspec/project.md` constrains note
   content from logs and diagnostics. A user pasting note text into a feedback
   body is their choice; the app must not add any itself

## Non-goals

- No telemetry, no automatic diagnostics, no crash reporting
- No in-app issue browsing or status tracking

## Impact

The only feature in 0.9.0 that reaches outside the app. It stays a user-initiated
hand-off to the browser, never a background transmission.
