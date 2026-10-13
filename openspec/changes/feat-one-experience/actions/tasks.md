# Tasks: Every action has two homes

- [ ] `shell.svelte.ts` store; `+page.svelte` reads it; `SettingsView` opens
      the page it is told
- [ ] `commands.ts`: the commands in design §2; `runCommand(id)`
- [ ] `events.rs` and `events.ts`: `menu:command` in, the six out; the
      contract test green; `docs/API.md` §9 says so
- [ ] `src-tauri/src/shell/menu.rs`: the menus of design §3, every item
      running `run_command`; `lib.rs` uses it; the tray rebuilt
- [ ] The "library too new" dialog runs `app.checkUpdates`
- [ ] `platform.ts`: `platformName()`; `SettingsAbout` per design §4
- [ ] `updater.svelte.ts`: `lastCheckedAt`, the toast; `toasts.show` duration
- [ ] Tests in design §6
- [ ] `docs/API.md` §9 and §13 (the setting); CHANGELOG lines
- [ ] In the app: the Help menu's Check for Updates opens Settings > About and
      checks; the tray's does the same; a pending update shows the toast
