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
The app SHALL provide a library window for browsing, editing, tagging, archiving, and deleting notes, with a sidebar offering exactly two sections: All Notes and Workspaces.

#### Scenario: Browse all notes
- **WHEN** the user chooses All Notes
- **THEN** the app lists every active note
- **AND** pinned notes appear at the top

#### Scenario: Filter by workspace
- **WHEN** the user selects a workspace in the Workspaces section
- **THEN** the app lists only notes collected in that workspace

#### Scenario: Reach archived and trashed notes
- **WHEN** the user opens the list filter in All Notes
- **THEN** the app can show archived or trashed notes
- **AND** no dedicated sidebar section is required

#### Scenario: Manage tags
- **WHEN** the user adds or removes a tag from a note
- **THEN** the sidebar tag counts update
- **AND** selecting a tag filters the note list to matching notes

### Requirement: Workspaces
The app SHALL let the user create named workspaces that collect notes and help organize them.

#### Scenario: Create a workspace
- **WHEN** the user creates a workspace with a name
- **THEN** the workspace appears in the Workspaces section
- **AND** shows a count of its notes

#### Scenario: Collect notes in a workspace
- **WHEN** the user adds a note to a workspace
- **THEN** the workspace lists that note
- **AND** a note may belong to more than one workspace

#### Scenario: Delete a workspace
- **WHEN** the user deletes a workspace
- **THEN** the workspace is removed
- **AND** its notes remain available in All Notes

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
