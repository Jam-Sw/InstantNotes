<script lang="ts">
  // ⌘K command palette: a centered overlay over a fuzzy-filtered command list,
  // plus notes (Recent when the query is empty, search hits once it isn't).
  // Commands are rebuilt each time it opens (theme list and selection-aware
  // labels stay current). Keyboard: ↑/↓ move (wrapping) across every visible
  // row, ↵ activates, Esc closes. Section-flattening and index math live in
  // palette-sections.ts so this file stays about wiring, not navigation math.
  import {
    buildCommands,
    filterCommands,
    recentCommands,
    recordRecent,
    childrenOf,
    findCommand,
    resolveActivation,
    type Command,
  } from "$lib/commands";
  import { listNotes, searchNotes } from "$lib/api/client";
  import { stripSentinels } from "$lib/highlight";
  import type { SearchResult } from "$lib/api/types";
  import { library } from "$lib/stores/library.svelte";
  import { formatDate } from "$lib/format";
  import { debounce } from "$lib/debounce";
  import {
    clampActive,
    flattenRows,
    moveActive,
    rowDomId,
    visibleSections,
    type PaletteSection,
  } from "$lib/palette-sections";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const RECENT_NOTES_LIMIT = 5;
  const NOTE_SEARCH_LIMIT = 8;
  const NOTE_SEARCH_DEBOUNCE_MS = 120;

  let query = $state("");
  let active = $state(0);
  // Which folder we are inside; null is the top level. Back-navigation and
  // breadcrumbs are derived from the commands' own parent pointers, so no
  // per-view enum or navigation stack is needed.
  let currentParent = $state<string | null>(null);
  let commands = $state<Command[]>([]);
  let input = $state<HTMLInputElement>();

  // Notes shown alongside commands. Only populated at the top level: inside a
  // folder (e.g. Themes) the palette is command-only, as before.
  let recentNotes = $state<SearchResult[]>([]);
  let noteHits = $state<SearchResult[]>([]);

  // The folder command we are inside, if any (for the back button + placeholder).
  const folder = $derived(findCommand(commands, currentParent));

  // Row shape rendered by the palette: a command keeps its full row (icon,
  // breadcrumb, shortcut, group…), a note is a quieter title + relative time.
  type PaletteRow =
    | { kind: "command"; id: string; command: Command }
    | { kind: "note"; id: string; note: SearchResult; title: string };

  // Empty query shows the current level (recents first at the top level);
  // otherwise the ranked fuzzy results over the current search scope.
  const commandResults = $derived.by(() => {
    if (query.trim()) {
      // Search the whole tree at the top level, the open folder's children when
      // inside one. Leaves matched outside their folder show a breadcrumb.
      const scope = currentParent === null ? commands : childrenOf(commands, currentParent);
      return filterCommands(scope, query);
    }
    const level = childrenOf(commands, currentParent);
    if (currentParent !== null) return level;
    const recents = recentCommands(commands);
    const seen = new Set(recents.map((c) => c.id));
    return [...recents, ...level.filter((c) => !seen.has(c.id))];
  });

  // A note with no title (still auto-titled, or briefly mid-save) falls back
  // to the first non-empty line of its excerpt, then to a plain "Untitled".
  // The palette shows no highlight, so the backend's match sentinels are
  // stripped from everything it renders. Only the sentinels: a broader
  // control-char sweep would eat the real newlines the line split relies on.
  function noteTitle(hit: SearchResult): string {
    const title = stripSentinels(hit.title).trim();
    if (title) return title;
    const firstLine = hit.excerpt
      .split(/\r?\n/)
      .map((line) => stripSentinels(line).trim())
      .find(Boolean);
    return firstLine || "Untitled";
  }

  const noteSections = $derived.by((): PaletteSection<PaletteRow>[] => {
    if (currentParent !== null) return [];
    const querying = query.trim().length > 0;
    const hits = querying ? noteHits : recentNotes;
    const rows: PaletteRow[] = hits.map((hit) => ({
      kind: "note",
      id: `note:${hit.noteId}`,
      note: hit,
      title: noteTitle(hit),
    }));
    return [{ label: querying ? "Notes" : "Recent", rows }];
  });

  // The command section keeps today's headerless look at the top level with
  // an empty query; querying (or being inside a folder) is unchanged too,
  // except it now gains a header once notes sit alongside it.
  const sections = $derived.by((): PaletteSection<PaletteRow>[] => {
    const cmdRows: PaletteRow[] = commandResults.map((cmd) => ({
      kind: "command",
      id: cmd.id,
      command: cmd,
    }));
    const label = currentParent === null && query.trim() ? "Commands" : "";
    return [{ label, rows: cmdRows }, ...noteSections];
  });

  const shownSections = $derived(visibleSections(sections));
  const flatRows = $derived(flattenRows(shownSections));
  const activeRow = $derived(flatRows[active]);
  // id -> flat index, so a row rendered inside a nested #each (sections, then
  // rows) still knows its place in the single navigable list.
  const rowIndex = $derived.by(() => {
    const map = new Map<string, number>();
    flatRows.forEach((row, i) => map.set(row.id, i));
    return map;
  });

  // Reset and focus whenever the palette opens.
  $effect(() => {
    if (open) {
      commands = buildCommands();
      query = "";
      active = 0;
      currentParent = null;
      recentNotes = [];
      noteHits = [];
      searchNotesDebounced.cancel();
      void loadRecentNotes();
      queueMicrotask(() => input?.focus());
    }
  });

  // Keep the active index in range as the flattened row count shrinks.
  $effect(() => {
    active = clampActive(active, flatRows.length);
  });

  // Debounced, stale-response-safe note search: a token bumped per request
  // so a slow earlier reply can never clobber a later one (mirrors the
  // refresh-token pattern in the library store).
  let recentToken = 0;
  let searchToken = 0;

  async function loadRecentNotes() {
    const token = ++recentToken;
    try {
      // list_notes already sorts pinned-first then by updated_at DESC, which
      // reads fine as "recent" too. Reshaped into SearchResult (body doubling
      // as excerpt) so noteTitle()'s fallback works the same for both lists.
      const notes = await listNotes({ limit: RECENT_NOTES_LIMIT });
      if (token !== recentToken) return;
      recentNotes = notes.map((n) => ({
        noteId: n.id,
        title: n.title,
        excerpt: n.body,
        score: 0,
        updatedAt: n.updatedAt,
      }));
    } catch {
      if (token !== recentToken) return;
      recentNotes = [];
    }
  }

  const searchNotesDebounced = debounce((q: string) => {
    const token = ++searchToken;
    searchNotes(q, NOTE_SEARCH_LIMIT)
      .then((hits) => {
        if (token !== searchToken) return;
        noteHits = hits;
      })
      .catch(() => {
        if (token !== searchToken) return;
        noteHits = [];
      });
  }, NOTE_SEARCH_DEBOUNCE_MS);

  // Query changes drive the note search; clearing the query must feel
  // instant, so it bypasses the debounce rather than waiting it out.
  $effect(() => {
    if (currentParent !== null) return;
    if (query.trim()) {
      searchNotesDebounced(query);
    } else {
      searchNotesDebounced.cancel();
      noteHits = [];
    }
  });

  function descend(id: string) {
    currentParent = id;
    query = "";
    active = 0;
  }

  function goUp() {
    currentParent = findCommand(commands, currentParent)?.parent ?? null;
    query = "";
    active = 0;
  }

  function run(cmd: Command) {
    const action = resolveActivation(commands, cmd);
    if (action.kind === "descend") {
      descend(action.parent);
      return;
    }
    // keepOpen is a property of the command (value pickers like themes set it),
    // so applying one stays open whether reached from its folder or a search.
    recordRecent(cmd.id);
    void cmd.run();
    if (!action.keepOpen) open = false;
  }

  function openNote(hit: SearchResult) {
    // Palette hits ignore the sidebar's current scope. If that scope cannot
    // show this note (a tag, workspace, search, or the trash view), widen it
    // first so the list, filters, and editor stay in sync after the jump.
    const visible = library.searchResults
      ? library.searchResults.some((h) => h.noteId === hit.noteId)
      : library.notes.some((n) => n.id === hit.noteId);
    if (!visible) {
      library.setStatusFilter("active");
      library.setTagFilter(null);
      library.selectWorkspace(null);
      library.setSearch("");
    }
    void library.select(hit.noteId);
    open = false;
  }

  function activate(row: PaletteRow) {
    if (row.kind === "command") run(row.command);
    else openNote(row.note);
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        active = moveActive(active, 1, flatRows.length);
        scrollActiveIntoView();
        break;
      case "ArrowUp":
        e.preventDefault();
        active = moveActive(active, -1, flatRows.length);
        scrollActiveIntoView();
        break;
      case "Enter":
        e.preventDefault();
        if (activeRow) activate(activeRow);
        break;
      case "Escape":
        e.preventDefault();
        if (currentParent !== null) goUp();
        else open = false;
        break;
    }
  }

  function scrollActiveIntoView() {
    queueMicrotask(() => {
      document
        .querySelector(`.cmd-row[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
</script>

{#if open}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) open = false;
    }}
    onkeydown={onKeydown}
  >
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
      {#if folder}
        <button class="back-btn" onclick={goUp}>
          ← {folder.title}
        </button>
      {/if}
      <input
        bind:this={input}
        bind:value={query}
        class="cmd-input"
        type="text"
        placeholder={folder ? `Search ${folder.title.toLowerCase()}…` : "Type a command or search notes…"}
        aria-label="Command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeRow ? rowDomId(activeRow.id) : undefined}
      />
      <div class="cmd-list" id="palette-listbox" role="listbox" aria-label="Commands and notes">
        {#if flatRows.length === 0}
          <div class="cmd-empty">No results</div>
        {/if}
        {#each shownSections as section, sectionIndex (sectionIndex + ":" + section.label)}
          {#if section.label}
            <div class="cmd-section-label" role="presentation">{section.label}</div>
          {/if}
          {#each section.rows as row (row.id)}
            {@const i = rowIndex.get(row.id) ?? -1}
            <button
              id={rowDomId(row.id)}
              class="cmd-row"
              class:active={i === active}
              class:emphasis={row.kind === "command" && row.command.emphasis}
              role="option"
              aria-selected={i === active}
              data-index={i}
              onclick={() => activate(row)}
              onmousemove={() => (active = i)}
            >
              {#if row.kind === "command"}
                <span class="cmd-title">
                  {#if row.command.icon}<span class="cmd-icon" aria-hidden="true">{row.command.icon()}</span>{/if}{#if row.command.prefix}<span class="cmd-parent">{row.command.prefix}</span><span class="cmd-crumb" aria-hidden="true">&rsaquo;</span>{/if}{#if row.command.parent && row.command.parent !== currentParent}<span class="cmd-parent">{findCommand(commands, row.command.parent)?.title}</span><span class="cmd-crumb" aria-hidden="true">&rsaquo;</span>{/if}<span class="cmd-action">{row.command.title}</span>
                </span>
                <span class="cmd-meta">
                  {#if row.command.isActive?.()}
                    <span class="theme-check">&#10003;</span>
                  {/if}
                  {#if row.command.shortcut}<kbd>{row.command.shortcut}</kbd>{/if}
                  {#if !(row.command.parent && row.command.parent !== currentParent)}<span class="cmd-group">{row.command.group}</span>{/if}
                </span>
              {:else}
                <span class="note-title">{row.title}</span>
                <span class="cmd-meta">
                  <span class="note-time">{formatDate(row.note.updatedAt)}</span>
                </span>
              {/if}
            </button>
          {/each}
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.32);
  }
  .palette {
    width: min(560px, 90vw);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    font-size: 12px;
    color: var(--text-tertiary);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
  }
  .back-btn:hover {
    color: var(--text-secondary);
  }
  .theme-check {
    color: var(--accent-text);
    font-size: 13px;
  }
  .cmd-input {
    border: none;
    outline: none;
    background: transparent;
    padding: 14px 16px;
    font-size: 15px;
    color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .cmd-input::placeholder {
    color: var(--text-tertiary);
  }
  .cmd-list {
    overflow-y: auto;
    padding: 6px;
  }
  .cmd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--radius);
    color: var(--text);
  }
  .cmd-row.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  /* The light/dark toggle is an action, not a theme: give it an accent border,
     bolder label, and a little breathing room below to part it from the list. */
  .cmd-row.emphasis {
    border: 1px solid var(--accent);
    margin-bottom: 6px;
    font-weight: 600;
  }
  .cmd-row.emphasis.active {
    border-color: transparent;
  }
  .cmd-icon {
    margin-right: 8px;
    color: var(--accent-text);
    flex-shrink: 0;
  }
  /* A flex row so the action label keeps its width while a long note-title
     prefix takes its own ellipsis instead of clipping the whole line. */
  .cmd-title {
    display: flex;
    align-items: baseline;
    min-width: 0;
    overflow: hidden;
  }
  .cmd-parent {
    color: var(--text-tertiary);
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }
  .cmd-crumb {
    margin: 0 6px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .cmd-action {
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmd-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    font-family: var(--font-meta);
  }
  .cmd-group {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .cmd-section-label {
    padding: 10px 10px 4px;
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .cmd-section-label:first-child {
    padding-top: 4px;
  }
  /* Unlike .cmd-action (command titles, always short), a note title is
     free-length user text, so it takes the ellipsis itself rather than
     leaning on a shrinking breadcrumb. */
  .note-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-time {
    color: var(--text-tertiary);
    font-size: 11px;
  }
  .cmd-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
  }
  kbd {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
