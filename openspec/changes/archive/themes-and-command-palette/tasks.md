# Tasks

- [x] Define the theme schema, token allow-list, and four built-in themes (light + dark)
- [x] Apply themes to :root at runtime (tokens, fonts, density, data-theme/-variant)
- [x] Validate and value-sanitize imported themes before applying any token
- [x] Add a rune theme store that persists the active theme and mode to settings
- [x] Convert app.css to the new tokens with Manuscript dark as the first-paint fallback
- [x] Add the sidebar theme picker (swatches, light/dark/auto, import/export)
- [x] Add thin Tauri file commands and a dialog picker for .intheme.json sharing
- [x] Reapply the theme in the capture window on show
- [x] Add the ⌘K command palette with fuzzy filtering, recents, and keyboard nav
- [x] Cover the validator, apply mapping, and command filter with Vitest
- [x] Cover the theme file round-trip with a Rust test
