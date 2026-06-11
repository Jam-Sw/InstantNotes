# InstantNotes Specification

## Requirements

### Requirement: Fast Note Capture
The app SHALL provide a lightweight capture panel for saving a note without using the full library window.

#### Scenario: Save captured text
- **WHEN** the user enters text in the capture panel and submits it
- **THEN** the app saves a note locally
- **AND** the capture panel closes
- **AND** the library can display the new note

#### Scenario: Preserve dismissed draft
- **WHEN** the user dismisses a non-empty capture panel without saving
- **THEN** the app stores the draft locally
- **AND** restores it the next time the capture panel opens

### Requirement: Local Notes Store
The app SHALL store notes, tags, settings, and search index data locally in SQLite.

#### Scenario: Create a note
- **WHEN** the user creates a note without a title
- **THEN** the app derives the title from the first meaningful line of the body
- **AND** stores the note with timestamps and version metadata

#### Scenario: Update a note
- **WHEN** the user edits note content
- **THEN** the app updates the note body, updated timestamp, version, and search index
- **AND** keeps a manually entered title unless the title is edited again

### Requirement: Library Organization
The app SHALL provide a library window for browsing, editing, tagging, archiving, and deleting notes.

#### Scenario: Filter by section
- **WHEN** the user chooses All Notes, Pinned, Archived, or Trash
- **THEN** the app lists only notes matching that section

#### Scenario: Manage tags
- **WHEN** the user adds or removes a tag from a note
- **THEN** the sidebar tag counts update
- **AND** selecting a tag filters the note list to matching notes

### Requirement: Search
The app SHALL provide full-text search over note title and body.

#### Scenario: Search notes
- **WHEN** the user searches from the library
- **THEN** the app returns matching notes with titles, excerpts, scores, and update timestamps
- **AND** excludes archived and deleted notes

#### Scenario: Search with punctuation
- **WHEN** the search text contains punctuation or special characters
- **THEN** the app sanitizes the query
- **AND** does not expose a search syntax error to the user

### Requirement: Privacy By Default
The app SHALL avoid writing note content to logs or diagnostics.

#### Scenario: Format protected content
- **WHEN** protected note content is formatted for debug or display logging
- **THEN** the formatted value is redacted

### Requirement: Desktop Shell
The app SHALL expose a macOS-oriented desktop shell with a tray entry, library window, and capture window.

#### Scenario: Open capture panel
- **WHEN** the user chooses the tray capture item or uses the global shortcut
- **THEN** the app shows the existing capture window
- **AND** focuses it without creating a new window instance

#### Scenario: Close library window
- **WHEN** the user closes the library window
- **THEN** the app hides the window
- **AND** keeps the desktop app running from the tray
