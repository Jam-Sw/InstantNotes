# Design: Agents scratchpad

## 1. Table and migration

Migration 17, appended to `MIGRATIONS` in `src-tauri/core/src/store.rs`:

```sql
CREATE TABLE agent_scratch (
  seq     INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  session TEXT NOT NULL,
  client  TEXT NOT NULL,
  kind    TEXT NOT NULL,
  text    TEXT NOT NULL
);
CREATE INDEX idx_agent_scratch_session ON agent_scratch(session, seq);
```

In `src-tauri/core/src/store/activity.rs`:

- `pub const SCRATCH_KINDS: [&str; 4] = ["note", "plan", "memory", "decision"];`
- `pub const SCRATCH_KEEP: i64 = 5000;` (rows kept in all, oldest deleted on write)
- `pub const SCRATCH_CHARS: usize = 20_000;`
- `pub struct ScratchEntry { seq: i64, at: i64, session: String, client: String, kind: String, text: String }`
  (Serialize and Deserialize, camelCase, Clone, PartialEq, Debug)
- `clear_activity` also runs `DELETE FROM agent_scratch`.
- `open_agent_session` is an upsert that keeps `label`, `client_session`, `cwd`, `client_pid` and
  `matched` on a reopen, so what a client said about its session survives a reconnect.

## 2. Store calls

- `Store::write_scratch(&mut self, session, client, kind, text) -> Result<ScratchEntry>`. Returns
  `Validation` when kind is not in `SCRATCH_KINDS`, when text is empty after trim, or when it is longer
  than `SCRATCH_CHARS` characters. Deletes the oldest rows beyond `SCRATCH_KEEP`.
- `Store::read_scratch(&self, session, limit) -> Result<Vec<ScratchEntry>>`. Covers this session and
  every session sharing its `agent_sessions.client_session`, oldest first, the last `limit` entries
  (clamped to 1..=500).
- `Store::count_scratch(&self, session) -> Result<i64>`, over the same session set.
- `Store::scratch_since(&self, after_seq, limit) -> Result<Vec<ScratchEntry>>`, all sessions, seq
  ascending.
- `Store::latest_scratch_seq(&self) -> Result<i64>`.
- `Store::list_scratch(&self, session, limit) -> Result<Vec<ScratchEntry>>`, one session only, oldest
  first, the last `limit` entries. This is the app's per-clock view.

## 3. MCP tools

`ToolDef` gains `read_only: bool` (the `readOnlyHint` annotation) and `traced: bool` (whether a call is
recorded in `agent_activity`). Existing tools set `read_only` true for read tools and false for write
tools, and `traced: true`. In `call()`, a tool with `traced: false` passes the access check and then
dispatches without a `Trace`.

Both new tools use `level: Access::Read` and `traced: false`, in `src-tauri/agents/src/tools.rs`.

**`scratchpad_write`**: title "Write to your scratchpad", read_only false, destructive false,
idempotent false. Arguments: `kind` (enum note, plan, memory, decision; default note) and `text`
(string, 1 to 20,000 characters, Markdown). Description, in full:

> Your working scratchpad for this session, shown live to the user in InstantNotes beside your activity,
> so they always know what you are doing and why. Write a note to yourself, a plan or what you are
> tracking, a change you made to your memory, or a decision. Never put this in the user's notes: a
> deliverable the user asked for is a note (create_note); your own working notes, plans and memory go
> here. Returns seq, at, kind and entries (how many this conversation holds).

**`scratchpad_read`**: title "Read your scratchpad", read_only true, destructive false, idempotent true.
Arguments: `limit` (integer 1 to 500, default 50). Description, in full:

> Read back your scratchpad for this conversation, oldest first, including what you wrote before a
> reconnect: use it after a restart or a context reset to pick up where you left off. Returns entries
> (seq, at, kind, text) and total.

## 4. Access decision

Both tools pass the normal access gate. With `agents.access` off they are refused. With Block they are
refused. With read access they are allowed, so a read-only agent may write its own scratchpad. A write
creates no note and no activity row.

## 5. Shell

- `src-tauri/src/events.rs`: `pub const AGENT_SCRATCH: &str = "agents:scratch";`
- `src-tauri/src/shell/agents.rs`: the watcher thread also tracks the latest scratch seq. When
  `data_version` moves, it emits `agents:scratch` with a `Vec<ScratchEntry>` holding the rows newer than
  the last announced seq, ascending, in batches of 200 (`SCRATCH_PAGE`).
- Command `list_agent_scratch(session: String, limit: Option<i64>) -> Vec<ScratchEntry>`, backed by
  `Store::list_scratch` with a default limit of 200, registered in `src-tauri/src/lib.rs`. Desktop only,
  not a web command.

## 6. Frontend

- `src/lib/api/events.ts`: `AGENT_SCRATCH: "agents:scratch"`.
- `src/lib/api/client.ts`: `listAgentScratch(session: string, limit?: number)` calls `list_agent_scratch`.
- `src/lib/agent-activity.ts`: `SCRATCH_KINDS` as a const tuple, `ScratchKind` and `AgentScratch`
  (seq, at, session, client, kind, text). `parseScratch(value: unknown): AgentScratch[]` validates
  each field. `scratchKindLabel(kind)` returns "Note to self" for note, "Plan", "Memory" and "Decision".
- `src/lib/stores/agents.svelte.ts`: `scratch = $state(new Map<string, AgentScratch[]>())` keyed by
  session, seq ascending. `init()` listens to `EVENTS.AGENT_SCRATCH` and appends, deduplicated by seq.
  `loadScratch(sessions: string[])` fetches each session not yet loaded. `scratchFor(sessions)` returns
  the merged list, seq ascending. `clear()` empties the map.
- `src/lib/components/AgentNote.svelte`: a fourth filter beside All, Changes and Failed, labelled
  "Scratchpad N", where N counts entries across `session.clocks[].session`. When selected, the rows show
  scratch entries instead of activity: time (`clockTime`), a kind badge (`scratchKindLabel`), and the
  text with `white-space: pre-wrap`, newest last, scrolled to the end on new entries. Empty state: "It
  has written nothing to its scratchpad. An agent's working notes, plans and memory land here, never
  in your notes." While the agent is connected and its newest entry is a plan, the status line shows
  that plan's first line after the activity description. The component calls
  `agents.loadScratch(session.clocks.map(c => c.session))` when the conversation changes.
- `src/lib/components/SettingsAgents.svelte`: under the connect instructions, one sentence: "An agent's
  own working notes, plans and memory go to its scratchpad on its page in the Agents Space, never into
  your notes."

## 7. Retention and limits

Retention is by row count: `SCRATCH_KEEP` (5000) rows in all, with the oldest deleted on each write.
Text is capped at `SCRATCH_CHARS` (20,000) characters. Reads are capped at 500 entries per call.
`clear_activity` removes the whole scratchpad.
