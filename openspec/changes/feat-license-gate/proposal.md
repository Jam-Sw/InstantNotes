# Change: License gate as a Space

## Why

InstantNotes is PolyForm Strict with the Jam-Sw EULA (PR #58). The installer
asks Windows users to agree, but the DMG and the AppImage have no license
step, and the maintainer wants every user to agree to both the source license
and the EULA before using the app. The generic `EulaGate` from `installers`
asked for the EULA only, in a modal that looked like no part of the app.

## What Changes

- On first launch, and whenever the license or the EULA gets a new version,
  the library opens into a License Space: the two documents as notes, each
  read in full and agreed on its own. Decline quits.
- Until both are agreed, everything else in the library is shown but out of
  reach (`inert`), every shortcut and menu command stands down, and the
  capture panel and stickies show one line and a way to the library.
- Once both are agreed the Space is gone, the same way the Update Space goes
  when there is nothing to install.

## Decisions

- **Render the shared gate, do not fork it.** `installers` now owns the
  agreement gate's contract: `agreements.json` (both texts, their versions,
  the gate's words), the rules, and `agreements.conformance.json` (the rules
  as cases). InstantNotes renders the generated `agreements.svelte.ts` as a
  Space instead of using the default `AgreementGate` view. The texts are never
  edited here; `apply.mjs` writes them.
- **Each window gates itself.** The root layout no longer wraps every window
  in one modal, which put a full EULA inside the capture panel and stickies.
- **Stored on the device, per document version**, under `jam-sw.agreements`,
  as the contract says. Nothing reaches the library or the vault.

## Impact

- Generated (from `installers`, `feat/agreement-gate`): `src/lib/agreements.svelte.ts`,
  `src/lib/AgreementGate.svelte`, `src/lib/agreements.test.ts`,
  `src-tauri/installer/agreements.json`, `agreements.conformance.json`;
  `src/lib/EulaGate.svelte` removed.
- New: `stores/license-space.svelte.ts`, `components/LicenseNote.svelte`,
  `components/LicenseLocked.svelte`.
- Changed: `routes/+layout.svelte`, `routes/+page.svelte`,
  `routes/capture/+page.svelte`, `routes/sticky/+page.svelte`,
  `components/Sidebar.svelte`, `components/NoteList.svelte`.
