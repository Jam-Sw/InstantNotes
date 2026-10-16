# Tasks: Diagnostics

- [x] `shell/log.rs`: `log`, rotation; tests; the writers of design §1
      (`a_line_is_the_time_the_event_and_flat_fields`,
      `the_file_rotates_once_at_the_limit_and_keeps_one_old_copy`,
      `the_tail_is_the_last_lines`; writers in backups.rs, mirror.rs,
      server.rs `record_report`, the panic hook, `report_frontend_error`)
- [x] `shell/diagnostics.rs`: the hook, the front-end report, list, read,
      delete, `diagnostics_report`; tests
      (`the_hook_writes_a_report_with_the_message_and_location`,
      `reports_list_newest_first_and_only_their_own_files`,
      `the_report_names_what_it_holds_and_nothing_else`)
- [x] `src/lib/diagnostics.ts`: the report text, the issue URL, the error
      handlers; tests (`diagnostics.test.ts`; the launch prompt and the
      desktop hand-off in `stores/diagnostics.test.ts`)
- [x] `SettingsDiagnostics.svelte` and tests; the `SettingsView` entry
      (Help group, every platform); the launch toast
      (`SettingsDiagnostics.test.ts`, `SettingsDiagnostics.web.test.ts`)
- [x] `commands.ts`: `app.sendDiagnostics` (every platform;
      `commands.test.ts` "runs them against their stores")
- [x] `docs/API.md` §13.1; `docs/DATA_MODEL.md` §8 and §12 for the keys and
      files; CHANGELOG lines handed to the integrator
- [ ] In the app: a forced front-end error produces a report; the prompt
      appears at the next launch with the switch on; Send opens the issue.
      Not run: reports go to the app data folder, which only the owner's
      machine has; `INSTANTNOTES_DB_PATH` moves the library, not `crashes/`.
