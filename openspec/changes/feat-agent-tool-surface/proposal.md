# Change: Agent tool surface

## Why

An audit of the MCP surface against four published guides found results that
cost an agent more context than the task needs. Measured through the real
server on a 120-note library with one 144,000-character note (bytes / 4 for
tokens):

| Call | Before | After |
| --- | --- | --- |
| `append_to_note` or `tag_note` on the big note | 144,025 characters (about 36k tokens) | 237 bytes |
| `get_note` on the big note | 144,321 bytes | 12,309 bytes |
| `search_notes` default page | 47,307 bytes (50 results) | 5,544 bytes (10 results) |
| CONFLICT from `update_note` on the big note | 144,423 bytes | 12,464 bytes |
| `get_notes` on 50 notes of about 3,000 characters | 155,848 bytes | 76,180 bytes |

Claude Code caps tool output at 25,000 tokens by default, so the first, second
and fifth rows exceeded it.

Sources: Anthropic, "Writing tools for agents" (return high-signal results;
pagination, range selection and truncation with sensible defaults; actionable
errors); the MCP tutorial "Writing effective tools"; Anthropic, "Building
effective agents" (agent-computer interface, poka-yoke); Microsoft, "Write
effective instructions for declarative agents" (steps with goal, action and
transition; positive phrasing; no contradictions).

## What Changes

- Write tools return the note without its body. `get_note` and `get_notes` cut
  a body at `maxChars` (default 12,000, 1,000 to 100,000), report `truncated`,
  `totalChars` and `nextBodyOffset`, and `get_note` reads on with `bodyOffset`.
  One `get_notes` call shares 60,000 characters, never under 1,000 a note.
- `edit_note` replaces one exact `oldText` that appears once. Before, changing
  one line meant reading and resending the whole body.
- `search_notes`: default 10 results; `detail: "titles"`; an empty query is an
  error; no match returns a `hint` (how many notes match any word); `status`
  adds `pinned` and `trash`, so it covers every `list_notes` status except
  `revisit`; the redundant `excerpt` is gone (`passages` carry it).
- Every page echoes `limit`. `suggest_space` pages (`offset`, `total`,
  `hasMore`). Refusals list the valid values and name `list_tags` or
  `list_spaces`.
- `create_note` and `add_to_space` return `createdSpace` when a name made a new
  Space.
- Resource reads are traced as `resources/list` and `resources/read`.
- A sheet's view carries `sheet.header`, its first row.
- `INSTRUCTIONS` is rewritten as vocabulary, rules and numbered steps, with no
  claim a tool contradicts. A test fails if it names a tool that does not
  exist.
- Results are compact JSON.
- The toolbox plugin's `/note` takes `/note <Space>: <text>` or a default
  Space, because `create_note` refuses an unfiled note once any Space exists.
- The activity feed words `get_notes`, `edit_note`, `suggest_space`,
  `append_sheet_rows` and the resource calls.

## Non-goals

- A `response_format` option on tools other than `search_notes`.
- Namespaced tool names: clients already prefix by server.
- Replacing note ids with names: ids are what calls chain on.
- A split of `status` into lifecycle and view: the superset on `search_notes`
  fixes what the audit found without renaming values clients already send.

## Impact

Core: `NoteSearch` gains `pinned_only` and `trashed`. No migration, no change
to note shape. Contracts in `docs/API.md` section 15 are updated. Tool
descriptions and `INSTRUCTIONS` changed, so the capture eval behind
`b94914d` (4/45 and 6/45 before, 39/45 and 38/45 after) was run again on the new
surface; the counts are in `tasks.md`.
