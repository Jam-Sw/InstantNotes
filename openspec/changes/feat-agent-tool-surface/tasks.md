# Tasks: Agent tool surface

Built on `0.9.4-pre`, after `feat/mcp-file-notes` merged.

## Decide first

- [x] Body cap: 12,000 characters a note (about 3,000 tokens), 60,000 shared
      per `get_notes`; both fit under Claude Code's 25,000-token output cap
- [x] Edit tool: exact `oldText`, once; no line numbers, no diff format
- [x] `status`: superset on `search_notes`, no renamed values on `list_notes`
- [x] `/note` with Spaces present: the plugin names a Space (`<Space>: <text>`
      or a default), the server stays strict for agents
- [x] Eval: the capture eval is re-run after the descriptions change

## Build

- [x] `agents/src/tools.rs`: lean `note_view`, body caps, `edit_note`, search
      `detail`, hints and `limit` echo, `createdSpace`, traced resources
- [x] `agents/src/protocol.rs`: `INSTRUCTIONS` rewrite, resource exchanges kept
      on the wire
- [x] Core: `NoteSearch.pinned_only` and `NoteSearch.trashed`
- [x] Frontend: `describeActivity` and `describeAttempt` cover every tool
- [x] `docs/API.md` section 15 and the changelog match
- [x] Toolbox plugin `/note` (separate repository)

## Verify

- [x] `agents/tests/mcp_test.rs`: 48 tests, including result-size budgets and
      the `INSTRUCTIONS` tool-name check
- [x] `cargo test`, clippy and rustfmt pass; `svelte-check` and `vitest` pass
- [x] Capture eval re-run on the surface before (`3486b53`) and after: 15
      capture tasks, 3 runs each, Claude Code headless with only this server
      connected. Pass is exactly one new note, filed in the expected Space.
      Haiku 39/45 before, 39/45 after. Sonnet 18/45 before, 28/45 after; its
      other runs appended to an existing note (26 before, 15 after). No unfiled
      note in 180 capture runs. The tasks are not the ones behind `b94914d`, so
      the counts do not compare with its 38/45 and 39/45.
- [x] Edit task, 3 runs per model per build: 5/6 before (one `update_note`
      dropped 8,819 characters of a 19,000-character note), 6/6 after with
      `edit_note`, each changing exactly 18 characters. Answer task 6/6 both.
- [ ] In the app: the activity feed lights the touched notes and words every
      tool (needs the window)

## Prompt text pass

Findings distilled from the meta-prompting corpus (distill-corpus run
`wf_cd0c1c19-445`), applied by hand and gated on the eval.

- [x] `INSTRUCTIONS`: labelled sections, positive rules, no emphasis words; a
      saved thought is a new note (`list_spaces`, then `create_note`), added to
      an existing note only when the user names it; per-tool procedure moved
      into the descriptions
- [x] Every description names the tool that supplies its ids and values, its
      return shape, its defaults, and the next step after each refusal;
      `edit_note` carries one worked example
- [x] Refusals say what went wrong, that nothing changed, and the fix;
      `fail` points a missing note id to `search_notes` and `list_notes`
- [x] `search_notes` results carry `kind` (`NoteMatch.content_kind`), so a
      sheet or whiteboard is known before a write
- [x] Tests pin every number quoted in the text to its constant
      (`quoted_numbers_match_the_constants`, `schema_defaults_are_the_constants`,
      `the_revisit_age_in_the_text_is_the_store_rule`)
- [x] A separate reviewer listed 20 mismatches between text and code; each
      was checked against the code and fixed
- [x] Eval, Haiku, 21 tasks (15 capture, 6 surface; c13 to c15, s05, s06 held
      out), 1 run each: 19/21 before, 21/21 after. c07 had appended to an
      existing note; after, 5/5 `list_spaces` then `create_note`. c14 (held
      out) 5/5 after. Capture calls per run 3.1 before, 2.2 after. Sonnet not
      run.
