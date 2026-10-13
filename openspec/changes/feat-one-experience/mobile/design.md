# Design: Mobile

The owner's plan of 2026-10-12 (`.claude/plans/mobile.md`), now this unit.
The same Svelte UI serves the phone's browser now and the native apps later,
so the layouts come first; the desktop stays pixel-identical.

## 1. Three layouts

`src/lib/stores/layout.svelte.ts` reads two media queries and one pointer
query and exposes:

- `mode`: `phone` below 600px, `tablet` from 600px to 960px, `desktop` above
  (960px is where 0.10.0 already hides the sidebar).
- `touch`: `(pointer: coarse)`.
- On the phone, `pane`: `list` or `note`, and the sidebar as a drawer
  (`sidebar.narrowOpen`, already there for the narrow desktop).

Desktop: unchanged, the three-column grid. Tablet: 0.10.0's narrow
behaviour, list and editor with the sidebar as a drawer, plus the touch
rules below. Phone: one pane at a time.

## 2. The phone

- The note list is the home pane. Its header gains a menu button that opens
  the sidebar drawer over it; the drawer closes when a Space, a tag, Graph or
  Settings is chosen.
- Selecting a note shows the editor pane; its header gains a back button
  (`pane = "list"`). A new note goes straight to the editor. Escape and the
  browser's back button both go back (the pane is pushed as a history entry,
  so the phone's back gesture works).
- Settings on the phone: the navigation list is the page; an entry opens its
  content full-width with a back button; Overview is an entry like the rest.
- Graph, the Update Space, Agents and Review merge render in the one pane.
- The command palette is a sheet from the bottom on the phone, and a floating
  button at the bottom right opens it on any touch device.

## 3. Touch

- Every button, row and chip is at least 44px tall under `[data-touch]`
  (pane headers 48px as now; list rows and sidebar rows grow; the toolbar's
  squares become 40px).
- `viewport-fit=cover` and `env(safe-area-inset-*)` on the first pane header,
  the status bar, the palette button and the drawer.
- The on-screen keyboard: the layout's height follows `visualViewport` so the
  editor's bottom and the status bar stay above the keyboard (`100dvh` where
  supported, the measured height otherwise).
- Desktop-only surfaces are already behind `isWeb`; on touch the hotkey hints
  (`Press Ctrl+K`) are replaced by "Tap the command button".

## 4. The editor on touch

CodeMirror handles touch selection and IME; the toolbar is the formatting
surface (no Mod shortcuts). Excalidraw: `whiteboard/design.md`. Sheets: the
grid scrolls both ways; a cell opens on tap, as Enter does.

## 5. Checks

- vitest: the layout store under each query; the page renders one pane on
  the phone and three on the desktop; the back button and the drawer.
- Screenshots from the real web app in headless Chrome against the e2e
  server at 390x844, 820x1180 and 1180x820 (`.claude/scripts/mobile-shots.mjs`,
  built on `web-offline-check.mjs`'s CDP driver), reviewed through
  `design-worker`, which also does the visual pass on the phone and tablet
  layouts.
- Desktop screenshots before and after, compared.

## 6. Native iOS and iPadOS (D4; owner-gated)

In this unit's tasks, unchecked until the owner has Xcode on the Mac and the
Apple Developer Program:

- Spike: `tauri ios init`; rusqlite bundled for `aarch64-apple-ios` and the
  simulator; one note surviving a relaunch on the simulator, then on his
  iPhone.
- Desktop-only plugins out of iOS builds: updater, global shortcut, single
  instance, tray, stickies.
- Two small Swift plugins: Keychain for the device token and the library key
  ("after first unlock, this device only"); `ASWebAuthenticationSession`
  sign-in with `instantnotes://auth/callback` and PKCE, which the server's
  `loopback_redirect` check allows as one more form, with a test.
- The library file under an iOS data-protection class.
- Sync when the app comes to the front and through `BGAppRefreshTask`;
  long-poll only in front; no push.
- iPad: windows, hardware keyboard shortcuts, Pencil, drag and drop.
- App Review: works fully with sync off; privacy label "no data collected";
  the export-compliance exemption for age, X25519 and ChaCha20 checked.
- Settings > About's Check for updates opens the App Store page.
- The licence against App Store distribution (PolyForm Strict): the owner's
  decision before submitting.
