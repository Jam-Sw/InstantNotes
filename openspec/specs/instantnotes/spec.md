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
- **AND** stores the note with created and updated timestamps

#### Scenario: Update a note
- **WHEN** the user edits note content
- **THEN** the app updates the note body, updated timestamp, and search index
- **AND** keeps a manually entered title unless the title is edited again

### Requirement: Library Organization
The app SHALL provide a library window for browsing, editing, tagging, archiving, and deleting notes, with a sidebar offering All Notes, Graph, and Workspaces (shown as Spaces), plus Revisit while there are captures to revisit.

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

### Requirement: Graph View
The app SHALL draw the library as a graph of notes, tags, and Spaces, linked by the tags and Spaces each note carries, derived from the notes at read time with nothing about the graph stored.

#### Scenario: See how notes connect
- **WHEN** the user opens Graph
- **THEN** every live note with a tag or a Space appears, joined to those tags and Spaces
- **AND** the app says how many notes have neither and are left out

#### Scenario: Go from the graph
- **WHEN** the user chooses a note, a tag, or a Space on the graph
- **THEN** the app opens that note, filters by that tag, or opens that Space

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

### Requirement: Image Cleanup
The app SHALL remove a copied-in image once no note, in any state, and no capture draft references it any more, and SHALL never remove an image something still references.

#### Scenario: Delete the last note using an image
- **WHEN** the user deletes a note for good and no other note references its images
- **THEN** those images are removed from the attachments folder
- **AND** from the vault's attachments folder when its copy is unchanged

#### Scenario: Keep images a trashed note uses
- **WHEN** an image is referenced only by a note in the Trash or the Archive
- **THEN** the image is kept

### Requirement: Whiteboard Notes
The app SHALL let a note be a whiteboard, a freeform canvas that stays a note: listed, tagged, filed in Spaces, trashed, and searched like any other.

#### Scenario: Turn a note into a whiteboard
- **WHEN** the user turns a document into a whiteboard and confirms
- **THEN** the note's text appears on the board as a text block
- **AND** the note cannot be turned back into a document

#### Scenario: Search a whiteboard
- **WHEN** the user searches for words written on a board
- **THEN** the board appears in the results
- **AND** every result is text visible on that board

#### Scenario: Never lose the last stroke
- **WHEN** the user draws on a board and immediately switches notes, trashes the board, or quits
- **THEN** the drawing is saved

#### Scenario: A board in the vault
- **WHEN** a vault folder is set and a board is saved
- **THEN** the vault holds the note file and a standard `.excalidraw` file beside it with the same name

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

### Requirement: Software Updates
The app SHALL offer an available update as a notification - a synthetic Space in the sidebar, not a modal dialog - and SHALL store nothing about it.

#### Scenario: An update is offered
- **WHEN** the app finds a newer release
- **THEN** an Update Space marked with a green asterisk appears first in the sidebar
- **AND** it holds the version jump, the size difference against the running version when known, and a button to install
- **AND** its release-notes note can be read in the ordinary editor
- **AND** neither note is written to the database or the vault

#### Scenario: Answering an update
- **WHEN** the user answers a finished install with Ok
- **THEN** the Update Space disappears
- **AND** the installed update applies the next time the app opens

#### Scenario: A manual check finds nothing
- **WHEN** the user asks to check for updates and none is available
- **THEN** the app says it is up to date, without a dialog
