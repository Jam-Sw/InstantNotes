# Tasks: Agents scratchpad

Built on `0.11.0-pre`. Order: core, agents crate, shell, frontend, docs, checks.

## Core

- [x] `src-tauri/core/src/store.rs`: migration 17 (`agent_scratch` table and index), appended to `MIGRATIONS`. Ran: `cargo test -p instantnotes-core --test scratch_test`, 5 passed
- [x] `src-tauri/core/src/store/activity.rs`: `SCRATCH_KINDS`, `SCRATCH_KEEP`, `SCRATCH_CHARS`, `ScratchEntry`, the six store calls, `clear_activity` deleting `agent_scratch`, and `open_agent_session` as an upsert. Tests: `src-tauri/core/tests/scratch_test.rs` (trim and order, keep 5000, validation, clear, the client_session rule across a reconnect)

## Agents crate

- [x] `src-tauri/agents/src/tools.rs`: `ToolDef.read_only` and `ToolDef.traced`, the `traced: false` dispatch in `call()`, tools `scratchpad_write` and `scratchpad_read` with the descriptions in design section 3. Tests: `src-tauri/agents/tests/mcp_test.rs` (write then read without a trace; refused with access off and for a blocked client; a bad kind names the four kinds; a reconnect sharing `client_session` reads the earlier entries). Ran: `cargo test -p instantnotes-agents --test mcp_test`, 58 passed

## Shell

- [x] `src-tauri/src/events.rs`: `AGENT_SCRATCH` constant. Test: `src/lib/api/contract.test.ts` holds it equal to `events.ts`
- [x] `src-tauri/src/shell/agents.rs`: watcher tracks the latest scratch seq and emits `agents:scratch` in batches of 200; command `list_agent_scratch` with default limit 200. Ran: `cargo test -p instantnotes --lib`
- [x] `src-tauri/src/lib.rs`: `list_agent_scratch` registered in the command handler. Ran: `cargo test -p instantnotes --lib` builds it

## Frontend

- [x] `src/lib/api/events.ts`: `AGENT_SCRATCH: "agents:scratch"`. Test: `src/lib/api/contract.test.ts`
- [x] `src/lib/api/client.ts`: `listAgentScratch(session, limit?)`. Ran: `npm run check`, 0 errors
- [x] `src/lib/agent-activity.ts`: `SCRATCH_KINDS`, `ScratchKind`, `AgentScratch`, `parseScratch`, `scratchKindLabel`. Test: `src/lib/agent-activity.test.ts`
- [x] `src/lib/stores/agents.svelte.ts`: `scratch` map, `init()` listener with dedupe by seq, `loadScratch`, `scratchFor`, `clear`. Test: `src/lib/stores/agents.svelte.test.ts`
- [x] `src/lib/components/AgentNote.svelte`: Scratchpad filter, scratch rows, empty state, plan line in the status line, `loadScratch` call. Test: `src/lib/components/AgentNote.test.ts`
- [x] `src/lib/components/SettingsAgents.svelte`: the one-sentence note under the connect instructions. Ran: `npm run check`

## Docs

- [x] `docs/API.md` section 15: two tool rows, the scratchpad paragraph, the `list_agent_scratch` command row, the `agents:scratch` event in the watcher paragraph
- [x] `docs/DATA_MODEL.md`: migration table rows v16 and v17, and a paragraph in section 11
- [x] `CHANGELOG.md` `[Unreleased]` Added: the scratchpad entry; the schema line says version 17
- [x] `README.md`: the Agents feature line names the scratchpad; `docs/images/agent-scratchpad.png` in Screenshots

## Checks

- [ ] `.claude/scripts/check.sh`: svelte-check, vitest, cargo test, clippy, rustfmt, wasm, knip in both modes
- [ ] The diff adds no code comments
