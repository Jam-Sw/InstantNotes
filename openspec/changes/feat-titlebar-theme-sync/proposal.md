# Change: Native titlebar follows the in-app dark/light theme

## Why
The library window keeps the native macOS titlebar, but the theme store never tells
macOS when the resolved light/dark variant changes. The titlebar and traffic lights
stay locked to whatever the system appearance was at launch, so switching to a dark
theme under a light system (or the reverse) leaves a mismatched bright titlebar above
a dark app.

## What Changes
- Add a thin `set_window_theme` command that sets the library window's native theme
  (Light or Dark) through Tauri's window API.
- Expose it as `setWindowTheme` in the IPC client.
- Sync it from the theme store whenever the resolved variant changes, alongside the
  existing vibrancy sync, so every theme or mode change repaints the chrome.

## Impact
Three small touch points: one Tauri command, one IPC wrapper, and one private sync
method on the theme store. The core crate is untouched. A no-op off macOS and in browser
dev. The borderless capture window has no native chrome and is left alone.
