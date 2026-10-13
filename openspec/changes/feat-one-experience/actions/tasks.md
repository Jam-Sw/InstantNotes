# Tasks: Every action has two homes

- [x] `shell.svelte.ts` store; `+page.svelte` reads it; `SettingsView` opens
      the page it is told
- [x] `commands.ts`: the commands in design §2; `runCommand(id)` (plus
      `view.about` and `app.openChangelog`, see design §2)
- [x] `events.rs` and `events.ts`: `menu:command` in, the seven out; the
      contract test green; `docs/API.md` §9 says so
- [x] `src-tauri/src/shell/menu.rs`: the menus of design §3, every item
      running `run_command`; `lib.rs` uses it; the tray rebuilt
- [x] The "library too new" dialog runs `app.checkUpdates`
- [x] `platform.ts`: `platformName()`; `SettingsAbout` per design §4
- [x] `updater.svelte.ts`: `lastCheckedAt`, the toast; `toasts.show` duration
- [x] Tests in design §6 (`npx vitest run` over commands, updater, toasts,
      contract, platform, SettingsAbout desktop and web, SettingsView: 95
      passed; `cargo test -p instantnotes --lib shell::menu`: 2 passed)
- [x] `docs/API.md` §7 (the setting) and §9; CHANGELOG lines
- [x] `.claude/scripts/check.sh` green after `cargo fmt`
- [ ] In the app: the Help menu's Check for Updates opens Settings > About and
      checks; the tray's does the same; a pending update shows the toast
      (runs with the in-app proof at hand-back)
