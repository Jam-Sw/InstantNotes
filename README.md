# InstantNotes

Instant notes for macOS — capture, organize, and search your thoughts.

InstantNotes is a desktop notes app built around fast capture and a focused library. Save a thought from anywhere with a global shortcut, then organize and retrieve it without being forced into a folder system.

## Features

- **Instant capture** — a lightweight capture panel summoned from the system tray or via `Cmd+Shift+N`, with drafts preserved if dismissed
- **Focused library** — a three-pane window for browsing, editing, tagging, pinning, archiving, and deleting notes
- **Full-text search** — SQLite FTS5 search over titles and bodies with ranked results; plain-language queries, no search syntax to learn
- **Tags, not folders** — lightweight labels, including tags extracted from `#inline` text
- **Local and private** — all data stored locally in SQLite; note content never appears in logs or diagnostics

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Core (persistence, search, commands) | Rust |
| Storage & search | SQLite + FTS5 |
| UI | Svelte 5 + TypeScript |
| Editor | CodeMirror 6 |
| Testing | cargo test, Vitest, svelte-check |

## Architecture

A local Rust core sits behind a thin desktop shell. Rust owns business rules and persistence; TypeScript owns view state and typed IPC calls. The library window, capture panel, and future settings window communicate through typed commands and change events. UI code calls the API client rather than invoking Tauri commands directly.

## Getting Started

### Prerequisites

- macOS
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+

### Develop

```sh
npm install
npm run dev
```

### Test

```sh
cargo test          # Rust core tests
npm test            # frontend tests (Vitest)
npx svelte-check    # component type checks
```

## Project Structure

```
src/          Svelte 5 frontend (library window, capture panel)
src-tauri/    Rust core and Tauri 2 shell
openspec/     Product specification and project conventions
static/       Static assets
```

## Specification

Product requirements and conventions live in [`openspec/`](openspec/):

- [`openspec/specs/instantnotes/spec.md`](openspec/specs/instantnotes/spec.md) — requirements and scenarios
- [`openspec/project.md`](openspec/project.md) — tech stack, architecture, and workflow conventions

## Contributing

This is a private project developed by the jam-sw team.

- Each branch should contain one clear product step
- All changes land via pull request into `main`
- Commit subjects stay short and concrete; bodies explain what changed in one or two sentences
- Core behavior is covered with Rust tests against SQLite; frontend utilities with Vitest; components must pass `svelte-check`
