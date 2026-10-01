# Tasks: Agent access

Built on `feat/agent-access` (its own worktree), off `0.9.0-pre` at `917dbd3`,
kept apart from the sticky-notes unit in flight on `0.9.0-pre`.

## Decide first

- [x] Standard: MCP, stdio, tools only
- [x] Transport: the app binary in a second mode, not an HTTP server in the
      running app (no port, no token, works with the app closed)
- [x] SDK: none. `rmcp` 3.5 adds 125 crates and a tokio runtime for four
      JSON-RPC methods; the loop is `protocol.rs` on `serde_json`
- [x] Conflict rule: `updatedAt` is the version; agents must send it; the
      user's typing wins and the user is told, with the agent's version
      offered back
- [x] Presence without a tab: the things touched light up; one line under
      All Notes (the placement the user proposed in their own note)

## Build

- [x] Core: `IMMEDIATE` transactions, `data_version`, `schema_is_current`,
      `expected_updated_at` (`core/tests/concurrency_test.rs`, two stores on
      one file)
- [x] Crate `instantnotes-agents`: protocol, tools, access gate, activity log
      (`agents/tests/mcp_test.rs`, 10 tests over in-memory pipes)
- [x] Shell: `main()` dispatch, `shell/agents.rs` watcher and
      `agent_connection`, `library:external-change` in both event registries
- [x] Frontend: `agent-activity.ts`, `stores/agents.svelte.ts`,
      `external-edit.ts`, save-queue version check, library adoption,
      presence hooks, `app.css` presence block, Settings > Agents
- [x] Tests: 511 frontend, 244 Rust; `npm run check`, clippy, fmt clean
- [x] Proven over real stdio against a read-only snapshot of the
      maintainer's library: handshake, all tools listed, Space listing, full
      reads of the "InstantNotes Bugs" Space, read-only refusal, a write,
      the activity log, and `vault_dirty` set by the existing triggers

## Standards and audit pass

Checked against the specification text, not memory: 2025-11-25 (tools,
schema) and 2026-07-28, which made MCP stateless.

- [x] Dual-era: `server/discover`, per-request `_meta` version, `resultType`,
      server identity in `_meta`, `ttlMs`/`cacheScope`, `-32022` naming the
      supported versions; `initialize` still serves 2025-11-25 to 2024-11-05
- [x] 2025-03-26 batches accepted (that revision says servers MUST)
- [x] Unknown tool and non-object `arguments` are `-32602`, not `isError`
- [x] Tools: `title`; `destructiveHint` true only where a write removes or
      replaces; `idempotentHint`; `openWorldHint: false`; schemas declare
      `additionalProperties: false` (the server already rejected extras) and
      describe every shared parameter; `structuredContent` on success
- [x] JSON-RPC: `jsonrpc` checked, ids must be strings or numbers, responses
      are never answered, a non-UTF-8 line is a parse error instead of the
      end of the server
- [x] Conformance: the real binary, driven over stdio against a copy of the
      maintainer's library, returns replies that validate against the
      official `schema.json` of each revision (46 checks; the validator
      rejects the old shapes, so it is not vacuous)
- [x] `tools.rs` split: `access.rs` (level and gate), `activity.rs` (the
      trace the app reads); `tools.rs` is only the tool surface
- [x] `shell/agents.rs`: the decision behind each `data_version` move is a
      pure function with its own tests
- [x] Found while auditing, fixed here: `get_or_create_tag` had no caller
      since the first UI commit (`0ff7598`), so its command, registration,
      client wrapper, and API.md row are gone (`Store::get_or_create_tag`
      stays, a tested core primitive); API.md now documents
      `set_notes_flags`, `soft_delete_notes`, `restore_notes`,
      `destroy_notes`, and `get_shortcut_failure`; §15 moved after §14
- [x] Found and left, with reasons and slots: `docs/TECH_DEBT.md`

## Before archiving

- [ ] The maintainer runs it: connect Claude Code from Settings > Agents,
      watch rows and the live line while it reads, type in a note while it
      appends
- [ ] Merge against the sticky-notes unit (shared files: `library.svelte.ts`,
      `NoteList.svelte`, `NoteEditor.svelte`, `events.ts`, `events.rs`,
      `lib.rs`, `+page.svelte`, `client.ts`, `docs/API.md`, `SEQUENCE.md`,
      `CHANGELOG.md`, and `library.svelte.test.ts`). A sticky window edits in the same process,
      so its writes do not move `data_version`; the library already stops
      editing a stickied note, which is what keeps them from colliding
