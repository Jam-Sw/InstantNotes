# InstantNotes: post-0.8 polish + in-app feedback

Date: 2026-07-11
Status: approved (decisions locked with owner), building this session

This spec covers the bug reports and feature asks that accumulated after 0.8.0
shipped, plus the first cut of an in-app feedback ability. The theme is "under
the hood of a sports car": the app stays effortless to drive (capture, write),
while Settings becomes the one place where the machine is visible and tunable.

## Owner decisions (locked)

1. Images added to a note are **copied in by default**, with a Settings toggle
   to instead **link the original file path**. Pasted screenshots always copy
   (no source file exists to link).
2. When a note is copied as AI context, images are **rewritten to their
   absolute path** by default (exposed as a Contexting setting; alternatives are
   keep-reference and strip).
3. The phantom-caret fix uses the **clean-state-per-note** approach
   (`view.setState`), which also isolates undo history per note.
4. The in-app feedback ability is **fully built** this session, not just spec'd.

## Work items

### 1. Phantom caret on note switch (bug)

Root cause: `<Editor>` is one persistent CodeMirror view reused across notes
(`+page.svelte`, unkeyed). Switching notes swaps the document with a replace-all
`changes` dispatch that sets no selection and never blurs (`Editor.svelte`).
CodeMirror maps the old cursor to position 0, and the forced `caret-color` on
`.cm-content` (`app.css`) lets WKWebView keep painting a caret in the unfocused
view. The same code path lets undo history bleed across notes.

Fix:
- Build the extension list once, then load each note with
  `view.setState(EditorState.create({ doc, selection: {anchor: 0}, extensions }))`.
  State fields reset on `setState`, so re-seed the three dynamic ones
  (preview mode, link prefs, attachments base) immediately after. This gives a
  clean selection and a fresh, per-note undo history.
- Add `.cm-editor:not(.cm-focused) .cm-content { caret-color: transparent }`
  so no caret is ever painted in an editor that does not have focus. This is the
  direct cure for a caret appearing in notes the user is only viewing.

### 2. Ctrl/Cmd-click opens a link but the cursor never becomes a pointer (bug)

Root cause: `linkMarkClass` only adds `cm-link-clickable` (which carries
`cursor: pointer`) when `preview && openWith === "click"`. In `modclick` mode
the class is never applied, so the link opens on modifier-click but the cursor
gives no feedback.

Fix: a CodeMirror view plugin tracks whether a Cmd/Ctrl modifier is currently
held (keydown/keyup, reset on blur) and toggles a `cm-mod-held` class on the
editor DOM. Theme rule: `.cm-mod-held .cm-link-target { cursor: pointer }`.
Because modifier-click always opens a link in either mode, this affordance is
always truthful. The Links settings sample mirrors it. Cross-platform: both
`metaKey` and `ctrlKey` are treated as the modifier everywhere (already the
convention); `modKey` from `platform.ts` supplies the correct label.

### 3. Save timestamp to the minute + settings grouping

`formatDate` shows time-only today, short-date otherwise, never a full stamp.

Fix:
- Add `formatExact(iso)` for a full local date and time to the minute.
- The editor status bar and every note-list date get a `title` carrying
  `formatExact`, so hovering always reveals the exact save time.
- A new **Editor** settings page (grouped, not a one-off module) hosts a
  "Show exact save time" toggle that switches the status-bar stamp to the full
  timestamp inline. It also hosts the existing "open formatting toolbar by
  default" preference, so related editor settings live together.

### 4. Images: storage policy, preview controls, and context handling

Today every image is copied to `$APPDATA/attachments` and referenced as
`attachments/<name>`. There is no user control and no context policy.

Fix, a new **Images** settings page plus supporting plumbing:
- Storage mode: Copy into InstantNotes (default, portable) or Link the original
  file. An "Insert image from file..." action (file dialog) honors the mode:
  copy reads the file into attachments; link inserts the absolute path.
- Linked (absolute-path) images render inline through Tauri's asset protocol.
  Security: each linked file is added to the asset scope at insert time and on
  note open via a narrow Rust command that validates it is an existing image,
  rather than broadening the static scope.
- Max preview height becomes a user setting (drives a CSS var the editor theme
  reads; default 420px, matching today).
- Attachments location, file count, and total size are shown, with an
  "Open attachments folder" button.
- Contexting image handling: `keep-reference | absolute-path | strip`, default
  absolute-path. Applied to the note body before the copy template renders.

### 5. Settings front page: the dashboard

The Home is currently a three-card nav grid. It becomes a real dashboard:
- Live stats from a new `library_stats` command: notes (total, pinned,
  archived, trashed), tags, spaces, attachments (count and size), and capture
  readiness (reusing the existing latency summary).
- "What's new in vX": the current version's section parsed from the bundled
  `CHANGELOG.md` (imported at build time; the webview CSP blocks external
  fetches, so parsing the bundled file keeps it offline and always correct for
  the installed build).
- The category nav (About, Editor, Images, Links, Contexting, Feedback) below.

### 6. In-app feedback (full build)

Entry points: a Feedback card on the Settings dashboard and a "Send feedback"
command in the palette.

Form: category (Bug, Idea, Other), a message, and an "include diagnostics"
toggle that attaches app version, platform, and the current stats snapshot (with
a visible preview of exactly what is attached: nothing hidden).

Delivery (works with no server, no auth):
- The submission is appended to `feedback.jsonl` in the app data directory via a
  Rust command, so it is never lost and can be reviewed or exported.
- The user is then handed a prefilled GitHub issue (title and body composed from
  the category, message, and opted-in diagnostics), opened through the existing
  `open_url` command against the public repo.

This is deliberately the seed of a larger system; see the extension notes below.

## Architecture notes

- New stores follow the existing runes-class + settings-KV pattern
  (`imagePrefs`, `feedback`, extended `editorPrefs` and `contexting`).
- New settings pages follow the existing per-page component pattern under
  `components/settings/`, routed from `SettingsView`.
- Pure logic (changelog parse, exact-date format, context image rewriting,
  absolute-path classification) lives in unit-tested modules, no runes.
- Backend additions match the existing command shape (`locked(&state)`, typed
  results, `CmdError` codes) and the shell file-IO validation style.

## Feedback system: where this goes next (not built this session)

The first cut delivers via GitHub issue + local log. Future extensions, each
additive and non-breaking:
- A direct submit path (a small ingest endpoint) so users never leave the app,
  with the local log as the offline queue that flushes when online.
- Triage tie-in: attach the diagnostics snapshot and recent non-fatal errors
  automatically, so a report is actionable without a back-and-forth.
- In-app changelog and "you asked, we shipped" surfacing on the dashboard, so
  the feedback loop is visible to the user who reported it.
- These build on the same dashboard stats and the same local log; nothing here
  forecloses them.

## Verification

- `npm run check` (svelte-check) and `npm test` (vitest) green, including new
  unit tests for the pure modules.
- `cargo build` and `cargo test` green for the new commands and store method.
- Manual: switch rapidly between notes and confirm no stray caret; confirm the
  pointer appears on links while the modifier is held in modclick mode; confirm
  the dashboard stats and changelog render; confirm a feedback submission writes
  the log and opens a prefilled issue.
