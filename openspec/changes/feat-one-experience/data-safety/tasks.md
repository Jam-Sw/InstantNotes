# Tasks: Data safety

- [x] `core/src/backup.rs`: `file_name`, `parse_name`, `keep`,
      `verify_backup`, `apply_pending_restore`; tests (design §8)
      (`cargo test -p instantnotes-core backup`: 8 passed)
- [x] `Store::detach_sync`; test (in `backup::tests`)
- [x] `core/src/vault/archive.rs`: the stored `.zip` writer; test reader
      (3 tests, CRC check value 0xCBF43926)
- [x] `vault::export_archive(store)`; web `export_archive()`
      (`export::tests::the_archive_holds_the_same_files_plus_the_attachments`)
- [x] `shell/backups.rs`: the thread, the commands of design §7,
      `backups:changed`; the restore marker applied in `setup` before the
      store opens, the dialog after (`cargo test -p instantnotes backups`)
- [x] `client.ts`, `types.ts`: wrappers and types; `src/lib/web/library.ts`
      returns the archive, `vault-export.ts` downloads it (tests)
- [x] `SettingsBackups.svelte` and its tests; the Export section leaves
      `SettingsSync.svelte`; `SettingsView` entry "Backups" (web: "Export")
      (9 desktop tests, 2 web tests)
- [x] `commands.ts`: `data.backupNow`, `data.export`, `data.backups`
      (`commands.test.ts`)
- [x] `docs/API.md` §12.5, `docs/DATA_MODEL.md` §8 and a §12 for the files
      beside the library; CHANGELOG lines
- [ ] In the app: back up now; restore from the list; restore from a file;
      export on the desktop; export in Chrome against the e2e server.
      Remains: a person at the desktop app, and `sync-e2e.sh up` (needs
      Docker) for the Chrome export; the logic is covered by
      `cargo test -p instantnotes-core backup`, `cargo test -p instantnotes
      backups`, `SettingsBackups.test.ts` and `SettingsBackups.web.test.ts`
