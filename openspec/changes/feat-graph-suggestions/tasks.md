# Tasks: Graph filing suggestions

SEQUENCE.md unit 13g. Built on `0.9.3-pre` on 2026-10-03; open until the
in-app checks pass, then this folder moves to `archive/`.

## Decide first

- [x] Model. **Dirichlet-Multinomial naive Bayes over tags and content
      words**, chosen against complement NB, a TF-IDF centroid, and a kNN
      Jaccard vote by `core/tests/suggest_bench_test.rs` (proposal §2).
      alpha 0.5, show at 0.5, evidence cap 12, inline tag 2 vs manual 1.
- [x] No embeddings, no dependency, no schema. Unit 14 keeps those.
- [x] Policy. **Suggest-only**, for the app and for agents.
- [x] Dismissals live in the settings table (`graph.dismissed`), keyed by
      ids; pruned on write and on Space delete.
- [x] Agents get a read-only `suggest_space`; their filings teach the model
      like anyone's (proposal §4).

## Build

- [x] Core: `domain::content_words`; `classify.rs` (pure model);
      `store/suggest.rs` (`space_suggestions`, `dismiss_space_suggestion`,
      `restore_space_suggestion`, pruning); `GraphLink.source`;
      `delete_workspace` prunes. Tests: `suggest_test.rs` (13),
      `graph_test.rs` (+1), domain (+4), `suggest_bench_test.rs` (2, the
      comparison and the sweep; `--nocapture` prints the tables).
- [x] Shell: `commands/graph.rs` with `library_graph`, `space_suggestions`,
      `dismiss_space_suggestion`, `restore_space_suggestion`.
- [x] Agents: `suggest_space` tool, read level, traced as a read;
      `mcp_test.rs` covers one note, all notes, a note with no evidence, and
      that nothing is filed.
- [x] Layout (`graph/layout.ts`): suggested edges, `tagSource`, hollow
      suggested notes, `populatedSpaces`, `neighbors(graph, id, hops)`,
      weaker and longer link force for suggestions.
- [x] View (`GraphView.svelte`): the list, Accept and Not this with Undo
      toasts, paging at 25, the lens with Show all / Around this note, edge
      styles by pattern, the legend, the footer's start hint, screen reader
      names. `GraphView.test.ts`: 15 tests including the panel, accept,
      dismiss and undo, paging at 200, and the failure path.
- [x] Store: `suggestionCount`, refreshed on every library change and after
      a dismissal; Sidebar Graph row badge.
- [x] Docs: API.md §4, §4.1, §15; DATA_MODEL.md §2.3, §8; spec.md;
      CHANGELOG Unreleased; SEQUENCE.md 13g.
- [x] `cargo test -p instantnotes-core -p instantnotes-agents`, clippy with
      `-D warnings`, `cargo fmt --check`, `npm run check` (0 errors),
      `npm test` (588) all green. The shell crate (`instantnotes`) was not
      compiled in the build environment, which lacks the Linux webkit
      libraries; CI's three-platform `tauri build --no-bundle` is the gate.

## Check in the app (maintainer)

Use a library with at least two Spaces holding a few notes each and some
notes in none.

- [ ] Open Graph with no note open: the whole library shows, the legend
      names four edge kinds, and inline vs added tag edges draw solid vs
      dotted on a note that has one of each.
- [ ] Open a note, then Graph: the view frames that note and its two-hop
      neighbourhood, lit; "Show all" fits everything and reads "Around this
      note" after.
- [ ] The list "Where these belong" shows each unfiled note with a Space, a
      percentage, and "because ..." reasons that read true for the note.
      Hovering a row lights the dashed edge; Tab into a row does the same.
- [ ] Add to <Space>: the row goes, the note gets the Space (check its
      chips), the Graph row count drops by one, the toast's Undo takes the
      note out again and the row returns on the next change.
- [ ] Not this: the note is unchanged, the row goes, the count drops, Undo
      brings it back. Rename the Space and the note: still dismissed.
      Delete the Space: `graph.dismissed` in the settings table no longer
      names it.
- [ ] Write `#tag` in an unfiled note where that tag belongs to one Space:
      the suggestion appears within a second of the save, with the tag as
      the first reason.
- [ ] A library with one Space: no list, and the footer says suggestions
      start once two Spaces hold notes.
- [ ] With an agent connected in write mode, have it call `suggest_space`
      and then `add_to_space` on the answer: the row goes as the trace shows
      the write; revert the write from the Agents Space and the row returns.
- [ ] Two hundred unfiled notes (or as many as you have): the list pages at
      25, the canvas stays readable, and the Graph opens without a stall.
- [ ] VoiceOver / Narrator: the list is announced as "Filing suggestions",
      a suggested note as "Note: ..., suggested for ...", and the two
      buttons by their full names.
