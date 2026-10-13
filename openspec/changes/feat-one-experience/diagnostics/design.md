# Design: Diagnostics

Two things a person needs when something goes wrong: the app remembers what
happened, and they can hand that over without pasting secrets. Nothing is
sent by the app; sending is the person opening a prefilled GitHub issue in
their browser, which is how feedback already reaches the project (D7).

## 1. The app log

`shell/log.rs`: `log(event, &[(key, value)])` appends one line
`<RFC 3339> <event> key=value …` to `<app data>/instantnotes.log`; at 1 MB
the file rotates to `instantnotes.log.1` (one kept). Values are never note
content; callers pass counts, ids, error strings. Writers in this change:
the panic hook, front-end errors, backup and restore outcomes, a failed sync
cycle (one line, the error), a vault flush error, the restore applied at
launch. The browser logs to the console as before.

## 2. Crash reports

`shell/diagnostics.rs`:

- `install_panic_hook(dir, version)`: `std::panic::set_hook` writes
  `crashes/crash-<stamp>.txt` with the version, OS, architecture, the panic
  message, its location and the thread name, then calls the previous hook.
  The release profile aborts on panic; the hook runs first.
- `report_frontend_error(message, stack, where)`: the page's `error` and
  `unhandledrejection` handlers call it (desktop) and it writes
  `crashes/error-<stamp>.txt`. On the web the same handlers keep the last
  twenty in `sessionStorage` for the report.
- `list_crash_reports()`, `read_crash_report(name)`, `delete_crash_report(name)`.

Reports are written always (D7). `diagnostics.crashReports` (default off)
decides whether the app brings them up: with it on, at launch, if there are
reports newer than the last prompt, a toast says "InstantNotes had a problem
last time. Review the report?" with **Review**, which opens Settings >
Diagnostics. With it off, the page still lists them when opened.

## 3. The report

`diagnostics_report()` returns plain text, the same on every platform where
a field exists:

```
InstantNotes 0.10.1 (desktop, Linux x86_64)
Library: 1,204 notes (3 archived, 12 in Trash), 41 tags, 9 Spaces, 86 images
Schema: v15; last integrity check 2026-10-11
Sync: server, encrypted, up to date 4 min ago, 0 conflicts
Backups: 7, newest 2026-10-13 06:00 (automatic on)
Crash reports: 1 (crash-20261012-231402.txt)
Log (last 40 lines):
…
```

No address, no person, no note text, no file paths outside the app data
folder. The browser builds its own from what it has (version, user agent,
storage estimate, sync stage, the stored errors).

## 4. Settings > Diagnostics

Crash reports (toggle: "Ask to review a crash report at the next launch"),
the list of reports with View and Delete, the report text in a box, **Copy**,
and **Send** (opens the GitHub issue, category bug, the report appended,
after the person has seen it). A line says what it holds and what it never
holds. Palette: `app.sendDiagnostics` opens the page.

## 5. Tests

`log.rs`: a line's shape, rotation at the limit. `diagnostics.rs`: the hook
writes a file with the message and location; a front-end report is written;
listing orders newest first. `diagnostics.ts`: the report text from a fixed
input; the GitHub URL carries it. The page per state; the toast only with
the switch on and only for new reports.
