# Change: Local Notes Engine

## Why
The app needs a reliable local store for notes, tags, settings, and search. SQLite with FTS5 gives us full-text search and ACID writes without a server process.

## What Changes
- SQLite-backed store as the single writer for all persistent state
- FTS5 full-text search index over note titles and bodies, kept in sync by triggers
- Tags and note-tag associations with join-based tag search
- Settings key-value persistence
- Soft delete with trash and restore
- Rust test suite that locks down the data model and search behavior

## Impact
Every other feature (shell commands, library UI, capture panel) reads and writes through this store. No user-visible UI yet — this is the engine room.
