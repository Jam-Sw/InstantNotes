# Change: Notes Library & Capture UI

## Why
The engine and shell exist to serve the user. This change delivers the actual interface: a library for browsing and editing notes, and a lightweight capture panel for quick entry.

## What Changes
- Three-pane library layout: sidebar (sections + tags), note list, editor
- Section filtering: All Notes, Pinned, Archived, Trash
- Tag sidebar with counts, tag selection to filter the note list
- Full-text search bar that queries the local FTS index
- CodeMirror editor for note content with inline `#tag` extraction
- Capture panel with quick-save, draft preservation on dismiss
- Frontend utility tests covering the API client and note helpers

## Impact
This is the user-facing product. The capture panel and library together cover the two core jobs: save a thought fast, and organize it later.
