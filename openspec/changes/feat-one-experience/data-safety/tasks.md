# Tasks: Data safety

- [ ] `core/src/backup.rs`: `file_name`, `parse_name`, `keep`,
      `verify_backup`, `apply_pending_restore`; tests (design §8)
- [ ] `Store::detach_sync`; test
- [ ] `core/src/vault/archive.rs`: the stored `.zip` writer; test reader
- [ ] `vault::export_archive(store, attachments)`; web `export_archive()`
- [ ] `shell/backups.rs`: the thread, the commands of design §7,
      `backups:changed`; the restore marker applied in `setup` before the
      store opens, the dialog after
- [ ] `client.ts`, `types.ts`: wrappers and types; `src/lib/web/library.ts`
      downloads the archive
- [ ] `SettingsBackups.svelte` and its tests; the Export section leaves
      `SettingsSync.svelte`; `SettingsView` entry "Backups" (web: "Export")
- [ ] `commands.ts`: `data.backupNow`, `data.export`, `data.backups`
- [ ] `docs/API.md` §12.5, `docs/DATA_MODEL.md` §8 and a §12 for the files
      beside the library; CHANGELOG lines
- [ ] In the app: back up now; restore from the list; restore from a file;
      export on the desktop; export in Chrome against the e2e server
