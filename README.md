# InstantNotes

Instantly externalize your writing. Capture and locate your thoughts.

## Features

- **Quick Capture:** Global hotkey (`Opt` / `Ctrl+Shift+Space`) with drafts.
- **Command Palette:** `Cmd/Ctrl+P` for actions, search, and themes.
- **Flexible Organization:** Group notes with Workspaces and `#inline` tags instead of strict folders.
- **100% Local & Private:** Everything lives in a local SQLite database. Zero telemetry.

## Installation
> The builds are unsigned, You will likely be prompted on first launch.
Download the latest build for your platform from the [releases page](../../releases). 

### macOS (Apple Silicon)

Download the `.dmg`, open it, and drag InstantNotes to Applications. 
The app is not notarized, macOS blocks the first launch with an "Apple could not verify" message. 
Clear the quarantine flag and it opens normally from then on:

```sh
xattr -d com.apple.quarantine /Applications/InstantNotes.app
```

Alternatively, after the blocked first launch, open System Settings, go to Privacy and Security, scroll down, and click "Open Anyway". On macOS 14 and earlier, right-click the app and choose Open instead.

### Windows (x64)

Download release then run installer. 
You will get a SmartScreen flags due to the unsigned build: 
    1. To proceed --> click "More info", then "Run anyway".

## Development
To build from source instead

### Prerequisites

- macOS, Windows
- [Rust](https://rustup.rs/) via rustup (the version is pinned by `rust-toolchain.toml`)
- Node.js 22+
- Windows: the Visual Studio Build Tools with the C++ workload

### Run the app

```sh
npm install
npm run tauri:dev
```

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

Produces the platform's bundles under `src-tauri/target/release/bundle/`: an `.app` and `.dmg` on macOS, an NSIS `-setup.exe` on Windows, and an `.AppImage` on Linux. The builds are unsigned (macOS is ad-hoc signed, not notarized), so downloaded copies require the first-launch steps described under [Installation](#installation). Builds made locally on your own machine open normally.

### Release (with self-update)

The app checks GitHub Releases for updates on launch and every 6 hours, via `latest.json` attached to the latest release. 

Release's are shown on update panel
Releases are built, signed, and published by CI:

```sh
# 1. Add a "## [X.Y.Z]" section to CHANGELOG.md describing the release.
# 2. Bump every version file in lockstep:
npm run bump X.Y.Z
# 3. Commit, tag, and push; .github/workflows/release.yml builds macOS, Windows,
#    and Linux in a matrix and assembles a draft release with a merged latest.json.
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z && git push origin vX.Y.Z
# 4. Smoke test the draft's artifacts, then publish the draft to ship.
```

`npm run bump` updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock together (the `instantnotes-core` crate versions independently). Publishing the smoke-tested draft is the deliberate ship gate; the draft stays invisible to the in-app updater until then.

CI signs the updater artifact with the minisign key stored in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the app verifies downloads against the matching public key in `tauri.conf.json`.


Product requirements and conventions live in [`openspec/`](openspec/):

- [`openspec/specs/instantnotes/spec.md`](openspec/specs/instantnotes/spec.md): requirements and scenarios
- [`openspec/project.md`](openspec/project.md): tech stack, architecture, and workflow conventions

### Contributing

This is a private project developed by the jam-sw team.

- Each branch should contain one clear product step
- All changes land via pull request into `main`
- Commit subjects stay short and concrete; bodies explain what changed in one or two sentences
- Core behavior is covered with Rust tests against SQLite, frontend utilities with Vitest, and components must pass `svelte-check`
