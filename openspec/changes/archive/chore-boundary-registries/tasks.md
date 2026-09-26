# Tasks: One registry per boundary fact

From `docs/CODE_SMELL_AUDIT.md`, phases 0–4 and 6. Landed on `0.9.0-pre` on
2026-09-25. View-only by the insertion rule: no persisted state, no store API
change, so it takes a slot of its own between units.

## Decide first

- [x] **Where the authority sits.** The core's `AppError::code()` keeps the
      strings; the shell's `ErrorCode` and the frontend's `ERROR_CODES` are
      mirrors, asserted equal. The core cannot depend on the shell crate, so a
      single Rust declaration was not available.
- [x] **How parity is enforced.** One vitest test reading the Rust source, not
      a generated JSON artifact: no build step, and it cannot pass against a
      stale file. Codegen (`specta`/`ts-rs`) was considered and is not
      warranted at this scale.
- [x] **What "unwritable" means for `CmdError`.** `code` is private and
      `From<AppError>` matches the variants exhaustively, so a new `AppError`
      variant fails to compile until the shell decides its code.

## Build

- [x] `src-tauri/src/error.rs`: `ErrorCode` (+ `Serialize` as its API string),
      `CmdError` with a private code and `storage`/`validation` constructors,
      `CmdResult`, and the `From<AppError>` exhaustive match. Tests: every core
      code is a known code and agrees with the match; a validation error
      serializes as `VALIDATION_ERROR`; every code round-trips.
- [x] 40 hand-rolled `code: "…"` sites replaced across `lib.rs`, `shell/files.rs`,
      `shell/capture.rs`, `shell/mirror.rs`, `commands/feedback.rs`, and
      `commands/vault.rs` (whose local `storage_error` helper is now redundant).
      Eight of them said `"VALIDATION"`.
- [x] `src-tauri/src/events.rs`: all 12 event names; every `emit` call uses one.
- [x] `src/lib/api/error-codes.ts`, `src/lib/api/events.ts` (with
      `LIBRARY_CHANGED_EVENTS`, which the store and the graph both listen to).
- [x] `client.ts`: one `asApiError` for both catch sites; an unrecognised code
      becomes `STORAGE_ERROR` with the original code kept in the message.
- [x] `errors.ts`: `Record<ErrorCode, string>` and `GENERIC_MESSAGE` for the
      four callers that asked for generic copy by passing `""`.
- [x] Every `listen` call and the store test's listener assertions use `EVENTS`.
- [x] `FeedbackInput.category: FeedbackCategory`; `AppErrorPayload.code: ErrorCode`.
- [x] `src/lib/api/contract.test.ts`: codes match the core, the Rust enum, and
      API.md §14; event names match the Rust list exactly; no `code:` or
      `emit(` literal in `src-tauri/src`, no `listen(` literal in `src`.
      Verified by mutation — renaming one side's `vault:status` fails it.
- [x] Docs: `API.md` §1, §3, §9, §14 name the registries and the parity test;
      `CHANGELOG.md` under 0.9.0.

## Found along the way

- [x] The audit called `"VALIDATION"` a live bug on the grounds that
      `friendlyMessage` would miss it. It is a latent one: `friendlyMessage` is
      only called by the library store and the sidebar, whose errors all come
      through `From<AppError>` with correct codes. The attachment, image, and
      feedback paths that said `"VALIDATION"` surface `e.message` directly, so
      users saw the same sentence before and after. Recorded in
      `docs/CODE_SMELL_AUDIT.md`.
- [x] `GraphView.test.ts` asserted the empty-note line without its sentence
      break, so it failed against the shipped copy. Fixed with the test's own
      regex, not by changing the copy.
