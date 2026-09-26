# Change: One registry per boundary fact

## Why

`docs/CODE_SMELL_AUDIT.md` (2026-09-25) found five smells with one root cause:
several values that cross the Rust↔TypeScript boundary had no authoritative
definition. Error codes were written in five places across three languages and
had already drifted — eight Rust sites hand-rolled `"VALIDATION"`, which is not
a code the app has ever recognised. Twelve event names existed only as bare
literals on both sides, so renaming either side would have dropped a listener
in silence, with nothing failing.

The audit's own measurement of that drift was that it was not caused by
carelessness: there were two ways to build a command error and only one of them
was correct. The fix is therefore to leave one way.

## What Changes

- Rust: `src-tauri/src/error.rs` owns `ErrorCode` (an enum, serialized as its
  API string) and `CmdError`, whose `code` field is private. A command error is
  built through `From<AppError>`, `CmdError::storage`, or
  `CmdError::validation` — the 40 literal `code: "…"` sites are gone, and the
  eight `"VALIDATION"` among them cannot be written again.
- Rust: `src-tauri/src/events.rs` declares every event name the shell emits.
- Frontend: `src/lib/api/error-codes.ts` and `src/lib/api/events.ts` are the
  mirrors. `ApiError.code`, `AppErrorPayload.code`, and `friendlyMessage` take
  `ErrorCode`; `MESSAGES` is an exhaustive `Record<ErrorCode, string>`, so a new
  code does not compile until it has user-facing copy.
- `src/lib/api/contract.test.ts` holds the four registries, `docs/API.md` §14,
  and the core's `AppError::code()` equal, and fails if any code or event name
  is written as a literal again.
- `FeedbackInput.category` is the `FeedbackCategory` union that already existed.

## Non-goals

- Branded `NoteId`/`TagId`/`WorkspaceId` types (the audit's phase 5). Largest
  churn in the codebase, no live defect behind it; deliberately deferred.
- The two-file IPC command surface (`client.ts` wrappers + `lib.rs` registration).
  Collapsing it needs codegen (`specta`/`ts-rs`) or a macro, which is a
  dependency decision, not a cleanup.
- Any behaviour change. Every error keeps the code and message it had, except
  the eight that said `"VALIDATION"` and now say `VALIDATION_ERROR`.
- `Tag.color` typing, and the settings keys (already consts; the literals are
  in tests, which legitimately pin the wire key).
