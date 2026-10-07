# Change: Agent access over MCP

## Why

The AI stage should not be AI built into the app. The first step is letting
any agent the user already runs (Claude Code, Codex, Cursor, Hermes) read and
write the library through a standard, so everything after it can be built on
top rather than inside. The user asked for exactly this in the library itself
(note "0.6.2"): an MCP server built in, following the protocol standard, not
overengineered, separable so the app behaves the same without it, with agents
searching through the same search the user uses. And a second note rules out
the obvious UI for it: no agents tab, which clutters; show it near All Notes.

## What Changes

- `instantnotes mcp --db <path>`: the app's own binary serves MCP over stdio.
  Fourteen tools (seventeen now; see `feat-agent-tool-surface`) map onto `Store`'s public API. Access is off by default, then
  read or read-and-write, re-read on every call. No permanent delete, settings,
  vault, or canvas at any level.
- Presence: every call is recorded in `agent_activity`; the app notices other
  processes' commits through SQLite's `data_version` and lights up what an
  agent touches (note rows, Spaces, tags, the open note), with one live line
  under All Notes naming who is doing what.
- Two writers, one note: `update_note` gains an optional version check. Agents
  must use it; the editor uses it too. An agent's edit to a clean open note
  lands as a CodeMirror change (caret kept, undoable, highlighted). A save that
  meets an agent's edit keeps the user's typing and offers the agent's back.
- Settings > Agents: access, connect commands, recent activity.

## Non-goals

- Transports other than stdio (HTTP, remote). stdio needs no port or token and
  every client supports it.
- MCP prompts; tools cover every read and write. Resources were added later for Claude Desktop's note picker.
- Embeddings and semantic search (SEQUENCE unit 14; one more tool later).
- A terminal or agent host inside the app ("0.6.2" floated it; connecting the
  agents the user already runs comes first).
- Windows: release builds use the GUI subsystem, which has no console stdio.
  macOS and Linux only until that is addressed.

## Impact

A new workspace crate (`src-tauri/agents`, depends only on core). Core: an
`IMMEDIATE` transaction default, `data_version`, `schema_is_current`, and the
optional version check. Shell: one watcher file and a `main()` dispatch. No
migration, no new dependency beyond `chrono` (already in the tree via core).
