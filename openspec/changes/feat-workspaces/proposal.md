# Change: Two-Section Library with Workspaces

## Why
The sidebar currently splits notes across four sections (All Notes, Pinned, Archived, Trash) before users have any way to group related notes. That spends sidebar space on note states instead of organization. Workspaces give users a way to collect related notes — projects, topics, areas — without forcing a folder system.

## What Changes
- Reduce the sidebar to exactly two sections: All Notes and Workspaces
- Add workspaces: named collections of notes; a note may belong to more than one workspace
- Selecting a workspace filters the note list to its collected notes
- Pinned notes float to the top of All Notes instead of having their own section
- Archived and trashed notes move behind a list filter in All Notes instead of dedicated sections
- Deleting a workspace never deletes its notes
- Workspace storage and membership in SQLite with typed commands, following the existing tag pattern

## Impact
The sidebar becomes the organization surface: All Notes for everything, Workspaces for structure. Pinning, archiving, and trash remain as note actions; they just stop being top-level destinations.
