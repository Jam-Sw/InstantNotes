# Tasks: One experience across devices (index)

Each unit's tasks are in `<unit>/tasks.md`, ticked with what ran. This file
holds the order, the cross-cutting checks and the hand-back.

## Order

- [ ] 1. `metadata`
- [ ] 2. `actions`
- [ ] 3. `writing`
- [ ] 4. `data-safety`
- [ ] 5. `diagnostics`
- [ ] 6. `server-operators`
- [ ] 7. `signed-installs` and `release-chain`
- [ ] 8. `sync-without-a-server` (decision record)
- [ ] 9. `mobile`
- [ ] 10. `whiteboard`

## Cross-cutting

- [ ] `openspec/SEQUENCE.md`: unit 13l, this change and its placement
- [ ] `CHANGELOG.md` `[0.10.1]`: one or two lines per unit, exact identifiers,
      every new or renamed environment variable named
- [ ] `docs/API.md` and `docs/DATA_MODEL.md` match the commands, events,
      settings keys and files this change adds
- [ ] `README.md`: self-hosting (people dir, usage, check, read-only root,
      arm64), installing (signed builds once D1 lands), the web-code hashes
- [ ] The operator's server session told what lands and in which release
      (`server-operators/tasks.md` §0)
- [ ] `.claude/scripts/check.sh` green at the final commit, with counts;
      `cargo xwin check --workspace --all-targets`; the WebAssembly check
- [ ] `.claude/scripts/build.sh linux windows macos` at the final commit
- [ ] `.claude/scripts/sync-e2e.sh test` and `inapp-proof.sh` green
- [ ] actionlint on `release.yml`
- [ ] `BIG-PICTURE.md` updated
- [ ] Hand-back: the os-done-or-not report, the merge-gate checklist filled,
      the owner's numbered steps, ending "committed locally, not pushed"
