# Change: macOS Capture Shell

## Why
A notes app needs to feel instant. The user should be able to capture a thought from anywhere — menu bar, global shortcut — without opening the full library window.

## What Changes
- System tray menu with quick-capture entry
- Global keyboard shortcut that summons the capture panel
- Hidden capture window that appears on demand, not a new window each time
- Typed IPC command layer connecting the Svelte frontend to the Rust core
- App state management that keeps the process alive when windows close

## Impact
The app now runs as a proper macOS citizen. Users can capture notes without breaking flow. The IPC layer sets the pattern for all future frontend-to-core communication.
