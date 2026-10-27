# Change: Agents scratchpad

## Why

A note the person asks an agent to write is a deliverable and a normal note. What an agent writes for
itself (its scratchpad, what it is tracking or deciding, what it changed in its memory) is a different
thing. It belongs in the Agents feature, next to the activity trace, readable live, and never in the
notes list. The goal is instant, complete understanding of what a connected agent is doing.

## What Changes

- Core: a new `agent_scratch` table (migration 17) and store calls to write, read, count, list and
  stream scratchpad entries. `clear_activity` also empties the scratchpad.
- MCP: two new tools, `scratchpad_write` and `scratchpad_read`. `ToolDef` gains `read_only` and `traced`
  so a tool can run without an `agent_activity` row.
- Shell: an `agents:scratch` event, emitted by the existing watcher thread, and a `list_agent_scratch`
  command (desktop only).
- Frontend: a Scratchpad filter on the agent's page, a scratchpad store keyed by session, and one
  sentence in Settings > Agents.
- Docs: `docs/API.md` section 15, `docs/DATA_MODEL.md` (migration v17 and section 11) and the
  `[Unreleased]` changelog entry.

## ADDED Requirements

### Requirement: Scratchpad entries

An agent MUST be able to write entries to its scratchpad. Each entry SHALL have one kind from `note`,
`plan`, `memory` or `decision`. The kind defaults to `note`. The text MUST be between 1 and 20,000
characters after trimming, and the store MUST keep at most 5,000 entries in all, deleting the oldest on
write. An invalid kind or text MUST be refused with `Validation`, and the refusal MUST list the valid
kinds.

#### Scenario: Entry refused for an unknown kind

- GIVEN a connected agent with write access
- WHEN it calls `scratchpad_write` with `kind` set to `todo`
- THEN the call is refused, the refusal lists `note`, `plan`, `memory` and `decision`, and no row is written

### Requirement: Scratchpad is its own log

Calls to `scratchpad_write` and `scratchpad_read` MUST NOT be recorded in `agent_activity`. A scratchpad
entry MUST NOT create a note, and a note MUST NOT be created from a scratchpad entry. The scratchpad
SHALL be shown only in the Agents feature, never in the notes list.

#### Scenario: Write leaves no activity row

- GIVEN a connected agent
- WHEN it calls `scratchpad_write` with kind `plan` and text `Check the Space names first`
- THEN one row appears in `agent_scratch`, no row appears in `agent_activity`, and the notes list is unchanged

### Requirement: Read back across a reconnect

`scratchpad_read` MUST return the entries of the calling session and of every session that shares its
`client_session`, oldest first, limited to the last `limit` entries (1 to 500, default 50). An agent
that reconnects within one conversation MUST see what it wrote before the reconnect.

#### Scenario: Entries survive a reconnect

- GIVEN an agent that wrote two entries in session A with `client_session` C
- WHEN it reconnects as session B with `client_session` C and calls `scratchpad_read`
- THEN the result holds both entries in the order written, and `total` is 2

### Requirement: The access gate applies

With `agents.access` off, or for a blocked client, both tools MUST be refused with the same message as
any other tool and MUST leave no row anywhere. With read access an agent MAY write its own scratchpad.

#### Scenario: Access off

- GIVEN `agents.access` is `off`
- WHEN an agent calls `scratchpad_write`
- THEN the call is refused naming Settings > Agents, and `agent_scratch` stays empty
