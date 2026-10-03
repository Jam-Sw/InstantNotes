# Change: Graph filing suggestions

SEQUENCE.md unit 13g. Built on `0.9.3-pre` on 2026-10-03.

## Why

The Graph (unit 13) shows how notes connect but does nothing with it. The
product thesis says resurfacing is closure: a parked note has to come back
concrete enough to act on. The most common unfinished act in the library is
a captured note that never got a Space. This unit makes the graph say where
each such note belongs, why, and how sure it is, with one tap to agree, so a
growing library sorts itself with the user's consent instead of reading as
clutter.

## What changes

- Core: `Store::space_suggestions` (`store/suggest.rs`) over a pure
  classifier (`classify.rs`) and a word tokenizer (`domain::content_words`).
  `library_graph` links now carry the tag edge's `source`.
  `dismiss_space_suggestion` / `restore_space_suggestion` keep one settings
  key, `graph.dismissed`. `delete_workspace` prunes it.
- Shell: the three commands above, in `commands/graph.rs` with
  `library_graph`.
- Agents: a read-only `suggest_space` MCP tool.
- View: the Graph draws suggested edges dashed, tag edges by source, frames
  the open note's two-hop lens by default, lists the suggestions beside the
  canvas with Accept and Not this (both with Undo), and carries a legend. The
  sidebar's Graph row counts the suggestions.

## Non-goals

- Embeddings, a model file, or any new dependency: unit 14 owns those, and
  SEQUENCE.md places it after the vault flips authority.
- Filing a note on the model's word, by the app or by an agent. Suggest-only.
- Re-sorting notes already in a Space.
- Links between notes (decided out in unit 13).

---

## 1. The design document, evaluated

The brief came as a four-layer architecture ("Confluence": DP-means and BM25
recall, a logistic head on frozen sentence embeddings, Dirichlet-Multinomial
explanations with a Wald threshold, a LinUCB bandit choosing five notes a
day) with six product options. The product reading is right; the machinery
was written for another stack and another stage of this project.

| # | Option | Brief said | Decision here | Why |
| --- | --- | --- | --- | --- |
| 1 | Sorting graph | Keep; make it the only view | **Keep.** The graph is where filing surfaces | The Graph place stays: removing a shipped sidebar entry in a patch release is scope nobody asked for. Sorting happens inline on it. |
| 2 | Drag to organize | Cut; one-tap accept | **Cut; one tap** | A suggestion the user has to drag is a suggestion that failed. |
| 3 | Pinned layout | Soft pins | **Keep soft, in-session only** | The layout already restarts from the last positions (`startLayout(previous)`); nothing stored, as unit 13 decided. |
| 4 | Time fade | Time as a feature, not a visual | **No visual; no feature either, yet** | At this stage recency only orders the list (newest unfiled first). A recency feature in the model is deferred: the benchmark has no drift scenario to measure it against. |
| 5 | Local lens | Default frame | **Default frame, two hops** | `neighbors(graph, id, 2)`: the open note, its hubs, and the notes they gather. "Show all" is the escape. |
| 6 | Written vs filed | Keep; subtle edge style | **Keep, as edge style and as model weight** | `note_tags.source` is free. Inline tag edges draw solid, manual dotted; an inline tag weighs 2, a manual one 1. |

What was cut from the stack, and why:

- **bge-micro ONNX embeddings and the logistic head.** SEQUENCE.md unit 14:
  "Needs embedding storage, so it cannot precede unit 10." This is 0.9.3. An
  ONNX runtime is also a native dependency on three platforms, a model to
  ship, and a `cargo` decision the maintainer takes deliberately, not inside
  a graph unit. The brief's "pure NumPy" and `partial_fit` are Python; this
  core is Rust.
- **LinUCB daily budget and nightly jobs.** A desktop app has no nightly, and
  a budget of five nudges a day is an engagement mechanic. The thesis
  measures success by the user re-checking less. The list shows what the
  evidence supports and nothing else; a count that reaches zero is closure.
- **Auto-route.** Moving a note without asking breaks "trust is release" the
  first time it is wrong. The threshold decides whether to *show*, never
  whether to *file*.
- **ColBERT MaxSim.** Needs token embeddings. The naive Bayes likelihood
  ratios are the explanation tokens, free.

What survived is the one layer the brief got exactly right for a library of
tags and short notes with no embeddings: Dirichlet-Multinomial naive Bayes,
its likelihood ratios as reasons, and a show threshold. Whether it is the
best fit or just the most convenient was the question of section 2.

## 2. The model, proven against three alternatives

`core/tests/suggest_bench_test.rs` builds seeded synthetic libraries (each
Space a topic vocabulary of 40 words, neighbouring topics sharing a third of
them, a 300-word background vocabulary, notes of 4 to 15 words, one in five
mentioning another topic, inline tags on 35% of notes and manual ones on
15%) and scores four methods on held-out unfiled notes:

- **naive Bayes** (shipped): Dirichlet-Multinomial, prior from Space size,
  evidence tempered past 12 features, shown at posterior >= 0.5 and only
  when the evidence itself favours the Space.
- **complement naive Bayes** (Rennie et al. 2003): a Space scored by how
  badly the note fits every other Space; same smoothing and threshold.
- **TF-IDF centroid**: cosine to each Space's centroid, softmax at
  temperature 10 to make a percentage.
- **kNN Jaccard vote**: the 7 most similar filed notes vote with their
  similarity.

Columns: precision (top-1 accuracy over what is shown), coverage (share of
notes shown), ECE (expected calibration error over the shown percentages, 5
bins; lower is better), 3 reasons (share of suggestions naming three),
small (accuracy on notes whose true Space is not the largest, shown or not),
ms (fit plus all held-out answers, release build).

```
2 Spaces, 30/70 (100 filed, 200 held out)
  method                     precision  coverage    ECE 3 reasons   small       ms
  naive Bayes (shipped)          0.939     0.980  0.039    0.969   0.930      0.8
  complement naive Bayes         0.935     1.000  0.034    0.955   0.930      0.5
  TF-IDF centroid                0.935     1.000  0.175    0.985   0.950      0.8
  kNN Jaccard vote               0.840     1.000  0.061    0.975   0.730      6.0

3 Spaces, 10/40/150 (200 filed, 300 held out)
  naive Bayes (shipped)          0.951     0.880  0.028    0.973   0.800      1.3
  complement naive Bayes         0.770     0.970  0.162    0.962   0.630      1.2
  TF-IDF centroid                0.977     0.727  0.256    0.986   0.635      1.3
  kNN Jaccard vote               0.659     0.957  0.167    0.965   0.445     16.0

6 Spaces, 5..160 (315 filed, 360 held out)
  naive Bayes (shipped)          0.962     0.867  0.038    0.965   0.817      2.5
  complement naive Bayes         0.805     0.914  0.125    0.933   0.683      3.7
  TF-IDF centroid                1.000     0.428  0.294    0.974   0.420      2.0
  kNN Jaccard vote               0.718     0.739  0.064    0.966   0.440     29.7

cold start, 4 x 2 (8 filed, 200 held out)
  naive Bayes (shipped)          0.769     0.540  0.076    0.259   0.467      0.3
  complement naive Bayes         0.766     0.535  0.086    0.262   0.460      0.3
  TF-IDF centroid                0.734     0.640  0.056    0.195   0.500      0.2
  kNN Jaccard vote               0.704     0.795  0.207    0.157   0.560      0.6

one giant, 400 vs 10/10/10 (430 filed, 200 held out)
  naive Bayes (shipped)          0.989     0.880  0.046    0.972   0.833      1.2
  complement naive Bayes         0.862     0.940  0.078    0.867   0.747      1.4
  TF-IDF centroid                1.000     0.640  0.307    0.891   0.607      1.5
  kNN Jaccard vote               0.313     0.990  0.531    0.980   0.080     24.4

5,000 notes, 8 Spaces (5000 filed, 480 held out)
  naive Bayes (shipped)          0.981     0.975  0.010    0.985   0.955     10.0
  complement naive Bayes         0.946     0.958  0.020    0.987   0.895     13.5
  TF-IDF centroid                1.000     0.525  0.275    1.000   0.536     15.7
  kNN Jaccard vote               0.942     0.827  0.074    0.997   0.750    751.4

long notes, 3 Spaces 20/60/120 (200 filed, 300 held out, 60 to 200 words)
  all four                       1.000     1.000  <0.01    1.000   1.000   10..212
```

**Verdict: naive Bayes, kept.** It is the only method that is both accurate
and calibrated on every uneven library: 0.94 to 0.99 precision with a
calibration error of 0.01 to 0.05, meaning a shown 80% is right about 80%
of the time. Complement NB matches it with two Spaces and collapses as
Spaces get uneven (0.77 precision, small-Space recall 0.63 at 10/40/150).
The TF-IDF centroid is precise but its percentage is an arbitrary
temperature, not a probability (ECE 0.18 to 0.31), and it abstains on half
the notes at six Spaces. kNN lets the giant Space swallow everything (0.31
precision, 0.08 small-Space recall) and costs 750 ms at 5,000 notes against
10 ms, and it is quadratic from there. On explainability all four can name
three reasons past the cold start; only the two Bayes variants name them as
weights of evidence that are also the score, so the reason shown is the
reason the suggestion exists.

Cold start is the honest weak spot of every method: with eight filed notes
the shipped model speaks for 54% of notes and is right 77% of the time, and
it has the lowest calibration error of the four there (0.076), so the shown
percentage says so. Three reasons are rare at cold start because three
shared features are rare. The test asserts this shape rather than hiding it.

Scale: the model recounts the whole library on every call. At 5,000 notes
that is 10 ms in release and about 110 ms in a debug build, inside the
graph's own 80 ms reload debounce. The library the maintainer expects may
run to thousands of notes; nothing here is quadratic.

### Tuning (`Params::default()`, each swept with the others held)

```
alpha      precision coverage ECE     show_at precision coverage ECE     cap   precision coverage ECE
0.1        0.907     0.926    0.065   0.4     0.930     0.912    0.036   4     0.946     0.799    0.076
0.25       0.926     0.908    0.033   0.5     0.941     0.875    0.034   8     0.942     0.864    0.039
0.5  <--   0.941     0.875    0.034   0.6     0.948     0.845    0.028   12 <- 0.941     0.875    0.034
1.0        0.955     0.832    0.051   0.7     0.959     0.811    0.025   24    0.941     0.876    0.034
2.0        0.973     0.778    0.087                                      none  0.941     0.876    0.034
```

- **alpha 0.5.** Against the brief's 1.0: the same precision within 1.5
  points, 4 points more coverage, and a calibration error of 0.034 against
  0.051. On the giant library alpha 1.0 showed 0.087 ECE and 0.5 shows
  0.046. Alpha 0.25 trades 1.5 points of precision for 3 of coverage at the
  same ECE; a wrong suggestion costs more trust than a missing one, so 0.5.
- **show_at 0.5.** A higher bar buys precision by hiding the 50 to 60% band,
  but that band is calibrated (its ECE is in the total) and the percentage
  is on the row. Showing "55%" and being right 55% of the time is the
  feature; hiding it is not.
- **evidence cap 12.** Unmeasurable on these libraries: synthetic words are
  independent, so long notes are only more certain, and even the 60 to 200
  word scenario separates perfectly. Real notes repeat correlated words, the
  naive independence assumption then multiplies the same evidence, and the
  cap is the guard against a 99.9% that means "long". 12 is the smallest
  value that costs no coverage in the sweep; 4 and 8 do. Kept, documented as
  a guard rather than a measured gain.
- **inline 2, manual 1.** Not swept: the synthetic generator cannot know what
  intent a tag carries. The weight states the product belief (written tags
  are what the note is about) and a core test pins that an inline tag beats
  a manual one in a symmetric library.

## 3. The UI, against the thesis

**Where it lives.** A 280 px list beside the canvas, inside the Graph pane,
titled "Where these belong" with the count. The list and the drawing are
one thing seen twice: every row is a dashed edge from its note to its Space,
and a row under the pointer or keyboard focus lights that note and edge.
Hidden when there is nothing to say. The graph itself is unchanged by the
list except for those dashed edges and the hollow notes they reach.

**One row, top to bottom:** the note's title (a button that opens it; what
the user wrote is the anchor), then "→ Space 84%", then "because #pasta,
simmer, ragu" (strongest evidence first, tags with their `#`, at most
three), then two buttons. Title first because the user recognises their own
words faster than a Space name; the percentage is set small and third-tier
so it informs without shouting.

**Actions, and what each does to the data:**

- **Add to <Space>**: `add_note_to_workspace(noteId, spaceId)`, the same
  membership the editor's chip writes. The row goes at once; the
  `workspaces:changed` event re-reads the list and the model counts the new
  member. Toast "Filed “Lasagne” in Recipes" with **Undo**, which is
  `remove_note_from_workspace`. Capture is discharge: filing costs one tap
  and is reversible, so it never becomes a decision to carry.
- **Not this**: `dismiss_space_suggestion(noteId, spaceId)`; the note is not
  touched. The pair is written to `graph.dismissed` on this device. Toast
  "Won't suggest Recipes for “Lasagne”" with **Undo**, which is
  `restore_space_suggestion` followed by a re-read. Both actions are
  idempotent on the backend, and both act on ids, so a stale row (the Space
  renamed, the note filed elsewhere meanwhile) either no-ops or fails with
  `NOT_FOUND` into a plain toast and a re-read; never on old data.

**Telling edges apart at a glance, color-blind safe.** Pattern and weight,
never hue alone: tag written in the note = thin solid; tag added = dotted
(2 3); Space = heavier solid (1.6); suggested Space = dashed (6 4) in the
accent. A note drawn only for its suggestion is a hollow circle with a
dashed outline: not yet anyone's. The footer carries a legend with a swatch
and the words for each of the four, in every theme's third-tier text color.
Tag nodes keep their user-chosen color; nothing else encodes meaning in
hue.

**Zero, one, two hundred.** Zero: no list, no footer line, nothing to
dismiss; the only mention is the footer's "Suggestions start once two
Spaces hold notes" when unfiled notes exist and fewer than two Spaces have
members, so a new user learns what makes it start. One: the list with one
row. Two hundred: the list shows the 25 newest with the total in the
heading and a "Show 25 more" button; the canvas draws dashed edges for the
rows on screen only, so the graph never becomes 200 dashed lines. Newest
first because resurfacing recent captures is the loop most worth closing.

**Keyboard and screen readers.** Every node is a focusable button named by
kind and label, and a suggested note is named "Note: Lasagne, suggested for
Recipes". The list is a `complementary` landmark "Filing suggestions" with
one `listitem` per row; the row's three buttons read as the note title,
"Add “Lasagne” to Recipes", and "Don't suggest Recipes for “Lasagne”". Focus
moving into a row lights its edge, same as hover. The legend is a list
named "Legend" whose items are the four edge names, swatches hidden from
assistive tech. Edges themselves carry no role: the panel and the legend
carry their meaning in words.

**The sidebar Graph row** shows the suggestion count as a `nav-count`, the
way Revisit does, hidden at zero, with a title "N notes could be filed". It
is the one place the feature resurfaces outside the graph, and it goes
quiet when the library is sorted.

**Lens.** With a note open, the graph frames the note, its tags and Spaces,
and the notes they gather (two hops, suggested edges included), lit, the
rest dimmed. "Show all" fits the library and becomes "Around this note".
Without an open note the whole library shows, as before.

Not a task manager: no due state, no badges that accumulate, no "you have
N things"; the count is of what the library can answer, and filing or
dismissing makes it smaller.

## 4. Agents and the model

Agents read and write notes, tags, and Spaces over MCP (unit 13d); every
call is traced and every write revertable. The app fans every agent write
out as all three library-changed events (`shell/agents.rs`), and the graph
and the store's suggestion count re-read on those, so no suggestion acts on
old data: a row is rendered from the last read, and Accept and Not this act
on ids against the store as it is now.

| An agent... | ...while the graph shows a suggestion | What happens |
| --- | --- | --- |
| files the note (`add_to_space`) into the suggested Space | the row is up | Events fire; the re-read finds the note filed, the row goes, and the model counts the new member. If the user tapped Add first, the agent's call is an idempotent no-op. |
| files the note into another Space | the row is up | The note is no longer unfiled, so the row goes. Nothing is re-sorted: a note in a Space is never suggested again. |
| creates a Space | scoring runs | An empty Space is not a class; it joins the model when it holds a live note. The two-Space start rule counts populated Spaces only. |
| renames a Space or a note | a dismissal exists for the pair | Nothing changes: `graph.dismissed` holds ids. Tested. |
| adds or removes tags (`tag_note`, `untag_note`) | rows are up | Evidence changes; `tags:changed` re-reads. A removed inline tag comes back on the next body edit, as the tool's own description says; the model follows the edges as they are. |
| trashes or restores a note | any | Trashed notes neither teach nor get suggestions; restoring puts the note back in both roles. |
| has its write reverted by the user | the user accepted a suggestion after that write | The revert restores the agent's before-snapshot, which predates the accept, so the membership goes with it and the suggestion simply reappears. That is the documented meaning of revert (restore exactly that snapshot); the user accepts again with one tap. If the agent wrote after the accept, the snapshot includes the membership and the revert keeps it. |
| destroys nothing | | Agents have no permanent delete. When the user destroys a note or deletes a Space, its dismissals are dropped: at once for a Space (`delete_workspace` prunes), and on the next write to the record for a note. Tested. |

**Exposing suggestions to agents: yes, read-only.** `suggest_space` returns,
for one note or every unfiled note, the Space, the probability, and the
reasons, from `Store::space_suggestions`, the same call the graph makes.
Reasons: an agent asked to "file my notes" was already doing this with a
worse model (its own reading of titles) and no calibration; giving it the
user's model means the agent and the user agree on where things go, and the
agent can show its reasons in the user's words. It is a read: traced as
one, refused when access is off, and its description tells the agent it
files nothing and to call `add_to_space` if it agrees. That keeps the policy
suggest-only on both sides: no tool, and no code path, files a note on the
model's say-so.

**An agent's filing as training signal: the same as the user's, by
design.** A membership is a membership; the model recounts it on the next
read with no notion of who made it. Marking it differently would need a
`source` on `note_workspaces`, which is a schema change to note-adjacent
state, placed after unit 9 by the insertion rule, and there is no evidence
yet that agent filings are worse than the user's. Two things make this
safe: the trace shows every agent filing and the user can revert it, and a
revert unteaches it on the next recount. Deferred: if agent filings turn
out to be noisy, weigh them lower via a source column, after unit 9.

## 5. Deferred, and why

- A recency feature in the model (the brief's "time as a feature"): no drift
  scenario in the benchmark to prove it; recency orders the list for now.
- Re-sorting filed notes (a note in Space A that also belongs in B): a
  different question (multi-label), and the list would never empty.
- Weighting agent filings differently: needs a schema change (section 4).
- A second-choice Space in a row: the threshold means at most one Space
  clears 0.5 per note; "Not this" plus the next read is the second choice.
- Embeddings and anything that needs a model file: unit 14.
