# Project Context

## Purpose
InstantNotes is a macOS desktop notes app built around fast capture and a focused library. The app should let a user save a thought from anywhere, then organize and retrieve it without forcing a folder system.

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

## Domain Context
Notes are the canonical user data. Tags are lightweight labels, including tags extracted from `#inline` text. Search must support plain user input without exposing FTS syntax errors.

## Important Constraints
- Notes are stored locally.
- Note content must not appear in logs.
- The capture path must stay lightweight.
- Generated build output is not committed.

## External Dependencies
No hosted service is required for the current app.
