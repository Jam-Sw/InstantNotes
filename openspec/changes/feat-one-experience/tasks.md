# Tasks: One experience across devices (index)

Each unit's tasks are in `<unit>/tasks.md`, ticked with what ran. This file
holds the order, the cross-cutting checks and the hand-back.

## Order

- [x] 1. `metadata`
- [x] 2. `actions`
- [x] 3. `writing`
- [x] 4. `data-safety`
- [x] 5. `diagnostics`
- [x] 6. `server-operators`
- [x] 7. `signed-installs` and `release-chain`
- [x] 8. `sync-without-a-server` (decision record)
- [x] 9. `mobile`
- [x] 10. `whiteboard`

## Cross-cutting

- [x] `openspec/SEQUENCE.md`: unit 13l, this change and its placement
- [x] `CHANGELOG.md` `[0.10.1]`: one or two lines per unit, exact identifiers,
      every new or renamed environment variable named
- [x] `docs/API.md` and `docs/DATA_MODEL.md` match the commands, events,
      settings keys and files this change adds
- [x] `README.md`: self-hosting (people dir, usage, check, read-only root,
      arm64), installing (signed builds once D1 lands), the web-code hashes
- [ ] The operator's server session told what lands and in which release
      (`server-operators/tasks.md` §0)
- [ ] The full check green at the final commit, with counts;
      `cargo xwin check --workspace --all-targets`; the WebAssembly check
- [ ] Linux, Windows and macOS builds at the final commit
- [ ] The sync end-to-end run and the in-app proof run green
- [x] actionlint on `release.yml`
- [ ] `BIG-PICTURE.md` updated
- [ ] Hand-back: the os-done-or-not report, the merge-gate checklist filled,
      the owner's numbered steps, ending "committed locally, not pushed"
