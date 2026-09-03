# Project Context

## Purpose
InstantNotes is a macOS desktop notes app built around fast capture and a focused library. The app should let a user save a thought from anywhere, then organize and retrieve it without forcing a folder system.

## Product Thesis
InstantNotes exists to close open loops (the Zeigarnik effect: unfinished intentions stay resident in the head until they are parked in a trusted system). Every stage of the roadmap serves one of three promises:

1. **Capture is discharge.** Writing the thought down must cost less than carrying it. The capture path stays under the reflex threshold; a feature that adds a decision at capture time is rejected on those grounds.
2. **Trust is release.** The mind only lets go if retrieval is guaranteed. Data solidity work (save queues, undo fidelity, race protection) is this promise stated in engineering.
3. **Resurfacing is closure.** A parked loop must come back at the right moment, concrete enough to act on. Notes already carry the data for this (`updatedAt`, `lastOpenedAt`, spaces, tags); the graph and local-AI stages build on it.

The target is **powerful, not simple**: simplicity through frictionless apparent complexity. The app helps, never hinders, never confuses, never overcomplicates. A growing library must not read as clutter; it should feel satisfying and be useful by default. The success metric is inverted from engagement: the system works when the user stops re-checking it.

Anti-goal: InstantNotes is not a task manager. Dates, checkboxes, and notifications belong to other tools; our thirds of the loop are trusted parking, clarifying, and resurfacing. New features are tested against one question: does this close loops or create them?

## Tech Stack
- Tauri 2 desktop shell
- Rust core for persistence, search, and command handling
- SQLite with FTS5 for local storage and full-text search
- Svelte 5 and TypeScript for the webview UI
- CodeMirror 6 for the library editor
- Vitest, svelte-check, and cargo test for verification

## Project Conventions

### Code Style
Rust owns business rules and persistence. TypeScript owns view state and typed IPC calls. UI code should call the API client instead of calling Tauri commands directly.

### Architecture Patterns
The app has a local Rust core behind a thin desktop shell. The library window, capture panel, and future settings window communicate through typed commands and change events.

### Testing Strategy
Core behavior is covered with Rust tests against SQLite. Frontend utilities are covered with Vitest. Svelte components must pass `svelte-check`; production web assets must build through Vite.

### Git Workflow
Each public branch should contain one clear product step. Commit subjects stay short and concrete; bodies explain what changed in one or two natural sentences.

### Change Proposals
`openspec/SEQUENCE.md` holds the order changes land in, the definition of done that gates each one, and the rule that places anything new. One unit is in flight at a time and lives as uncommitted work until it is complete.

Active OpenSpec change proposals live in `openspec/changes/`. Once a change has shipped, its folder moves to `openspec/changes/archive/` so the active list only shows work in flight. The canonical IPC and storage contracts are documented in `docs/API.md` and `docs/DATA_MODEL.md`.

## Domain Context
Notes are the canonical user data. Tags are lightweight labels, including tags extracted from `#inline` text. Workspaces are named collections that group related notes; a note can belong to more than one, and deleting a workspace never deletes its notes. Search must support plain user input without exposing FTS syntax errors.

### Glossary: Space = Workspace
The product term is **Space** (sidebar, copy, component names). The storage tables, IPC command names, and Rust core keep the original **workspace** name. This is deliberate: renaming storage internals is churn with no user value. The one place the two vocabularies meet is `src/lib/api/client.ts`, which documents the boundary; UI and store code say "space", everything from the command strings down says "workspace".

## Important Constraints
- Notes are stored locally.
- Note content must not appear in logs.
- The capture path must stay lightweight.
- Generated build output is not committed.

## External Dependencies
No hosted service is required for the current app.
