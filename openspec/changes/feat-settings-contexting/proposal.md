# Change: Settings wiki navigation and the Contexting copy format

## Why
The settings view shipped as a sidebar with a single About tab and an empty placeholder.
Two needs push it forward: settings should grow without becoming a long scroll, and the
app needs a foundation for AI features. The answer is a wiki-style settings shell, a
landing grid of categories that open focused sub-pages, plus a first new category,
Contexting, that controls what copying a note hands to other tools.

## What Changes
- Replace the settings sidebar with a landing grid of category cards; each card opens a
  focused sub-page with a breadcrumb back to the grid. Escape steps back to the grid
  before closing the view.
- Keep the existing About page; drop the empty Default New Tab placeholder.
- Add a Contexting category: a user-editable copy template with {title}, {tags}, {date},
  and {content} placeholders, a live preview, and the list of available variables.
- Add a "Copy note as context" command to the palette that renders the template for the
  selected note and writes it to the clipboard.
- Persist the template to the settings KV, and render it from a pure, tested module.

## Impact
A new pure module (contexting-format) with tests, a small rune store, one palette command,
and a rewritten SettingsView. Clipboard uses the WebView's navigator.clipboard, so no new
native dependency or capability is added. The core crate is untouched.
