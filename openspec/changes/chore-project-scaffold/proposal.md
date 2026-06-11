# Change: Project Scaffold

## Why
InstantNotes needs a desktop shell to build on. Tauri 2 gives us a lightweight macOS binary with a Rust backend and Svelte frontend, without the overhead of Electron.

## What Changes
- Initialize a Tauri 2 + Svelte 5 project
- Configure the macOS bundle with the app identity and entitlements
- Add Vite, Vitest, svelte-check, and Cargo test scripts
- Set up the source tree layout (Rust core, Svelte routes, shared types)

## Impact
Every subsequent feature builds on this scaffold. No user-facing behavior yet — this is the foundation.
