# InstantNotes

Instant notes for macOS. Capture, organize, and search your thoughts.

InstantNotes is a desktop notes app built around fast capture and a focused library. Save a thought from anywhere with a global shortcut, then organize and retrieve it without being forced into a folder system.

## Features

- **Instant capture**: a lightweight capture panel summoned from the system tray or via `Cmd+Shift+N`, with drafts preserved if dismissed
- **Focused library**: a three-pane window for browsing, editing, tagging, pinning, archiving, and deleting notes
- **Full-text search**: SQLite FTS5 search over titles and bodies with ranked results, using plain-language queries with no search syntax to learn
- **Tags, not folders**: lightweight labels, including tags extracted from `#inline` text
- **Local and private**: all data stored locally in SQLite; note content never appears in logs or diagnostics

## Installation

InstantNotes runs on macOS (Apple Silicon). Download the latest `.dmg` from the [releases page](../../releases), open it, and drag InstantNotes to Applications.

The app is not notarized, so macOS blocks the first launch. Right-click the app in Applications, choose Open, then Open again. After that it opens normally with a double-click.

If macOS still refuses to open it, clear the quarantine flag:

```sh
xattr -d com.apple.quarantine /Applications/InstantNotes.app
```

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
