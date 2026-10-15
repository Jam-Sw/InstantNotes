# Tasks: Mobile

## A. Layouts and touch (this release)

- [x] `layout.svelte.ts`: `mode`, `touch`, `pane`, the history entry; tests
      (6 in `layout.svelte.test.ts`)
- [x] `+page.svelte`: one pane on the phone; the drawer; the palette sheet
      and button; `app.html` `viewport-fit=cover` (5 in `routes/page.test.ts`)
- [x] `NoteList.svelte`: the menu button; `NoteEditor.svelte`: the back
      button; `Sidebar.svelte`: closes on choice; `SettingsView.svelte`:
      the phone navigation. Built in `+page.svelte` instead: the menu and
      back buttons sit over the first pane's header and the drawer closes
      when the view changes, so the list, editor and sidebar are untouched;
      the drawer also carries Settings. Phone settings test in
      `SettingsView.test.ts`
- [x] `app.css`: `[data-touch]` sizes, safe areas, the viewport height
- [x] `CommandPalette.svelte`: the sheet on the phone
- [x] `.claude/scripts/mobile-shots.mjs`; screenshots at the three sizes.
      Shots taken through Chrome DevTools device emulation against a local
      `instantnotes-server` with real notes typed in; the desktop shot at
      1440x900 is byte-identical decoded before and after. The script is
      written but was not run end to end
- [ ] `design-worker`: the visual pass with before and after
- [ ] README and CHANGELOG: the phone layout line of 0.10.0 replaced
- [ ] In the app: Chrome device mode at the three sizes; the owner's iPhone
      and iPad in Safari against his server

## B. Native iOS and iPadOS (owner-gated, D4)

Waiting on the owner: building, signing and running on a device need
Xcode on the Mac and an Apple Developer Program membership, neither of
which an agent can install or hold. The plan is design §6.

- [ ] Owner: Xcode installed on the Mac; the Apple Developer Program
- [ ] The spike of design §6
- [ ] The plugins, protection class, sync scheduling, iPad checks, App Review
      items of design §6
