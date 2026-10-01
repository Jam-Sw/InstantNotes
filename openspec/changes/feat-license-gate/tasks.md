# Tasks: License gate as a Space

See `SEQUENCE.md` §13f.

## Decide first

- [x] Form. **A License Space with the two documents as notes, app locked**
      (decided 2026-09-30), over one full-window page.
- [x] Ownership. **The gate is shared across Jam-Sw apps** (decided
      2026-09-30): `installers` owns the data and the rules, each toolkit has
      one thin gate, and InstantNotes renders the Svelte one its own way.

## Build

- [x] Merge `main` (PR #58: license, EULA, installer art) into `0.9.0-pre`
- [x] Re-run `installers/scripts/apply.mjs` from `feat/agreement-gate`
- [x] License Space store, document page, sidebar row, note list
- [x] Lock: sidebar `inert`, shortcuts, menu events, Settings, graph
- [x] Capture panel and stickies stand down until agreed
- [x] Docs: changelog, SEQUENCE §13f

## Verify

- [x] `npm test` (shared conformance cases; License Space lock and order)
- [x] `npm run check`
- [x] `cargo test --workspace`, clippy, fmt after the merge
- [ ] In the app, with storage cleared: the library opens into the License
      Space, nothing else responds, each document agrees on its own, and the
      app opens after the second
- [ ] Capture shortcut while locked shows the message, and its button opens
      the library
- [ ] Decline quits
- [ ] `installers` PR (`feat/agreement-gate`, stacked on #2) merged before
      0.9.0 ships, then `apply.mjs` re-run on the merged `main`
