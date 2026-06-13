# Change: Portable Theme Engine and Command Palette

## Why
The baseline UI shipped with functional styling and a note in `app.css` that the
full visual language would land in M4. The design direction settled on four
dark-first, near-monochrome themes — Manuscript, Graphite, Terminal, and Paper
Dark — each with a light variant. Users also want to switch and share themes,
not just receive whatever ships. A theme should be a single portable file that
"just works" when handed to another user. Alongside the visual language, a ⌘K
command palette gives a fast, keyboard-first way to run actions and switch
themes without hunting through menus.

## What Changes
- Introduce a data-driven theme system: a theme is a typed token set (colors,
  fonts, metrics) for light and dark, applied to `:root` as CSS custom
  properties at runtime. Existing tokens are kept; `--font-body`, `--font-meta`,
  `--accent-text`, and `--density` are added.
- Ship four built-in themes, each with light and dark variants. The default is
  Manuscript dark, which is also the first-paint fallback in `app.css`.
- Make themes portable: export the active theme to a `.intheme.json` file and
  import one back. Imported themes are validated and value-sanitized before any
  token is applied, so a malformed or hostile file is rejected and nothing is
  applied.
- Add a sidebar theme picker: theme swatches, a light/dark/auto toggle, and
  import/export buttons.
- Add a ⌘K command palette: a fuzzy-filtered overlay with keyboard navigation
  and recents, covering note actions, theme switching, light/dark toggle, and
  theme import/export.
- Persist the active theme and mode to the existing settings store; the capture
  window reapplies the theme when shown.

## Impact
The app gains a shareable visual identity and a keyboard-first command surface.
The Rust core is untouched; the only shell additions are two thin file-I/O
commands and the dialog plugin for the native open/save picker. The two-section
library IA (All Notes and Workspaces) is preserved.
