# InstantNotes

Instant notes for macOS. Capture, organize, and search your thoughts.

InstantNotes is a desktop notes app built around fast capture and a focused library. Save a thought from anywhere with a global shortcut, then organize and retrieve it without being forced into a folder system.

## Features

- **Instant capture**: a lightweight capture panel summoned from the system tray or via `Cmd+Shift+N`, with drafts preserved if dismissed
- **Focused library**: a two-section sidebar (All Notes and Workspaces) over a note list and editor, with pinned notes floated to the top and a status filter for archived and trashed notes
- **Workspaces**: named collections that group related notes; a note can live in many workspaces, and deleting a workspace never deletes its notes
- **Full-text search**: SQLite FTS5 search over titles and bodies with ranked results, using plain-language queries with no search syntax to learn
- **Command palette**: a `Cmd+K` palette for running actions and switching themes, with arrow-key navigation and recents; search reaches into sub-menus (typing a theme name jumps straight to it), and the Themes sub-menu applies each theme live so you can preview as you arrow through
- **Tags, not folders**: lightweight labels, including tags extracted from `#inline` text
- **Local and private**: all data stored locally in SQLite; note content never appears in logs or diagnostics

## Installation

InstantNotes runs on macOS (Apple Silicon). Download the latest `.dmg` from the [releases page](../../releases), open it, and drag InstantNotes to Applications.

The app is not notarized, so macOS blocks the first launch with an "Apple could not verify" message. Clear the quarantine flag and it opens normally from then on:

```sh
xattr -d com.apple.quarantine /Applications/InstantNotes.app
```

Alternatively, after the blocked first launch, open System Settings, go to Privacy and Security, scroll down, and click "Open Anyway". On macOS 14 and earlier, right-click the app and choose Open instead. This is a first-install step only: the in-app updater applies later versions without any of it.

To build from source instead, see [Development](#development).

## Development

### Prerequisites

- macOS
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+

### Run the app

```sh
npm install
npm run tauri dev
```

This builds the Rust core, starts the Vite dev server, and launches the app. Frontend changes hot-reload instantly; Rust changes trigger an incremental rebuild and app restart.

### Test

```sh
cargo test --manifest-path src-tauri/Cargo.toml  # Rust core tests
npm run check                                    # type-check frontend (runs svelte-kit sync)
npm test                                         # frontend unit tests (Vitest)
```

### Build

```sh
npm run tauri build
```

Produces an `.app` bundle and `.dmg` under `src-tauri/target/release/bundle/`. Without an Apple Developer ID the bundle is ad-hoc signed and not notarized, so downloaded copies require the first-launch steps described under [Installation](#installation). Builds made locally on your own machine are not quarantined and open normally.

### Release (with self-update)

The app checks GitHub Releases for updates on launch and every 6 hours, via `latest.json` attached to the latest release. Each release's "What's new" text - shown in the in-app update panel and on the GitHub release - comes from the matching `CHANGELOG.md` section. Releases are built, signed, and published by CI:

```sh
# 1. Add a "## [X.Y.Z]" section to CHANGELOG.md describing the release.
# 2. Bump every version file in lockstep:
npm run bump X.Y.Z
# 3. Commit, tag, and push; .github/workflows/release.yml builds, signs, and
#    publishes the release on a successful build (no draft step to forget).
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z && git push origin vX.Y.Z
```

`npm run bump` updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock together (the `instantnotes-core` crate versions independently). Pushing a `v*` tag is the deliberate ship gate.

CI signs the updater artifact with the minisign key stored in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the app verifies downloads against the matching public key in `tauri.conf.json`. If the secret is ever lost, generate a new keypair with `npm run tauri signer generate`, update both the secret and the pubkey, and ship one manual release so installs can cross over.

For a fully local release without CI, build with `TAURI_SIGNING_PRIVATE_KEY` set, run `./scripts/make-update-manifest.sh`, and upload the dmg, `InstantNotes.app.tar.gz`, and `latest.json` with `gh release create`. Release downloads must be publicly reachable for the in-app check to work.

### Project structure

```
src/          Svelte 5 frontend (library window, capture panel)
src-tauri/    Rust core and Tauri 2 shell
openspec/     Product specification and project conventions
static/       Static assets
```

### Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Core (persistence, search, commands) | Rust |
| Storage and search | SQLite + FTS5 |
| UI | Svelte 5 + TypeScript |
| Editor | CodeMirror 6 |
| Testing | cargo test, Vitest, svelte-check |

### Architecture

A local Rust core sits behind a thin desktop shell. Rust owns business rules and persistence; TypeScript owns view state and typed IPC calls. The library window, capture panel, and future settings window communicate through typed commands and change events. UI code calls the API client rather than invoking Tauri commands directly.

Product requirements and conventions live in [`openspec/`](openspec/):

- [`openspec/specs/instantnotes/spec.md`](openspec/specs/instantnotes/spec.md): requirements and scenarios
- [`openspec/project.md`](openspec/project.md): tech stack, architecture, and workflow conventions

### Contributing

This is a private project developed by the jam-sw team.

- Each branch should contain one clear product step
- All changes land via pull request into `main`
- Commit subjects stay short and concrete; bodies explain what changed in one or two sentences
- Core behavior is covered with Rust tests against SQLite, frontend utilities with Vitest, and components must pass `svelte-check`
