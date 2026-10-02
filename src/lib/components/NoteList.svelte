<script lang="ts">
  import { library, type StatusFilter } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { clientLabel } from "$lib/agent-activity";
  import { formatDate, formatExact, preview } from "$lib/format";
  import { captureShortcut, modKey, shiftKey } from "$lib/platform";
  import { parseHighlightSegments } from "$lib/highlight";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { groupNotes } from "$lib/note-groups";
  import { updateSpace } from "$lib/stores/update-space";
  import { isUpdateSpaceId } from "$lib/update/space";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { isAgentsSpaceId } from "$lib/agents/space";
  import { isSyntheticSpaceId } from "$lib/synthetic";
  import { agreements } from "$lib/agreements.svelte";
  import { licenseSpace } from "$lib/stores/license-space.svelte";

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "trash", label: "Trash" },
  ];

  // Time-bucketed sections (Pinned / Today / Yesterday / ...). Revisit stays
  // flat: it sorts oldest-first by capture date, which time-of-edit buckets
  // would fight. "Now" is sampled per list change, matching platform behavior
  // (a list left open across midnight regroups on its next change).
  const groups = $derived(
    library.revisitMode ? null : groupNotes(library.notes, new Date()),
  );

  // The kinds of note this toolbar can create. Clicking ＋ makes a document,
  // the common case, in one click. The chevron (or a right-click anywhere on
  // the control) opens the list, which is the only visible place a whiteboard
  // can be started from.
  // A synthetic Space (the update, the agent trace) has no rows in the store:
  // its notes are derived, so they are rendered from where they come from.
  const syntheticNotes = $derived(
    isUpdateSpaceId(library.activeWorkspaceId)
      ? updateSpace.notes
      : isAgentsSpaceId(library.activeWorkspaceId)
        ? agentsSpace.notes
        : null,
  );

  // An agent's latest search, shown only while the field is empty: the
  // user's own words always come first.
  const agentSearch = $derived(library.searchText ? null : agents.currentSearch);

  let newMenu = $state<{ x: number; y: number } | null>(null);
  let newControl = $state<HTMLDivElement>();

  // Right-click on a row: pop that note out as a sticky, or bring it back.
  let rowMenu = $state<{ x: number; y: number; id: string } | null>(null);

  function openNewMenu() {
    const rect = newControl?.getBoundingClientRect();
    if (!rect) return;
    newMenu = { x: rect.left, y: rect.bottom + 4 };
  }

  function rowClick(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey) {
      void library.toggleInSelection(id);
    } else if (e.shiftKey) {
      void library.extendSelectionTo(id);
    } else {
      void library.select(id);
    }
  }

  async function confirmEmptyTrash() {
    const ok = await confirmDialog.ask({
      title: "Empty the Trash?",
      body: "All notes in Trash will be permanently deleted. This action cannot be undone.",
      confirmLabel: "Empty Trash",
      tone: "danger",
    });
    if (ok) await library.emptyTrash();
  }
</script>

<section class="list-pane">
  {#if licenseSpace.locked}
    <!-- The License Space's two documents. Nothing else is reachable until
         both are agreed, so no search or New here. -->
    <div class="pane-header" data-tauri-drag-region></div>
    <div class="note-list">
      {#each licenseSpace.documents as doc (doc.id)}
        <button
          class="note-row"
          class:selected={licenseSpace.shown?.id === doc.id}
          onclick={() => licenseSpace.show(doc.id)}
        >
          <div class="row-title">
            {#if licenseSpace.isAgreed(doc.id)}<span class="agreed-mark" aria-label={agreements.copy.agreed}>✓</span>{/if}
            {doc.title}
          </div>
          <div class="row-preview">{licenseSpace.isAgreed(doc.id) ? agreements.copy.agreed : `Version ${doc.version}`}</div>
        </button>
      {/each}
      <div class="empty-state">{agreements.copy.lead}</div>
    </div>
  {:else}
  <div class="pane-header list-toolbar" data-tauri-drag-region>
    <!-- An agent just searched: its words show in the search field itself,
         where a search belongs, in place of the placeholder. Nothing is
         added above the list, so the list does not move. The button runs
         the same search for you. -->
    <div class="search-wrap" data-agent={agentSearch ? "search" : null}>
      <input
        class="search"
        type="search"
        placeholder={agentSearch
          ? `${clientLabel(agentSearch.client)} searched “${agentSearch.query}”`
          : "Search notes…"}
        value={library.searchText}
        oninput={(e) => library.setSearch(e.currentTarget.value)}
      />
      {#if agentSearch}
        {@const search = agentSearch}
        <button
          class="agent-search-run"
          title="Run this search yourself"
          onclick={() => library.setSearch(search.query ?? "")}
        >
          {search.noteCount} hit{search.noteCount === 1 ? "" : "s"}
        </button>
      {/if}
    </div>
    <div
      class="new-control"
      bind:this={newControl}
      oncontextmenu={(e) => {
        e.preventDefault();
        openNewMenu();
      }}
      role="presentation"
    >
      <button class="new-note" title={`New note (${modKey}N)`} onclick={() => library.newNote()}>＋</button>
      <button
        class="new-kind"
        title="Choose what to create"
        aria-label="Choose what to create"
        aria-haspopup="menu"
        aria-expanded={newMenu !== null}
        onclick={() => (newMenu ? (newMenu = null) : openNewMenu())}
      >
        <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1.5 5 5 9 1.5" /></svg>
      </button>
    </div>
  </div>
  {#if library.activeWorkspaceId && !library.searchResults && library.workspaceTags.length > 0}
    <!-- Tags found on this space's notes; a chip filters within the space,
         unlike the sidebar's global tags which replace it. -->
    <div class="space-tags" role="group" aria-label="Filter this space by tag">
      {#each library.workspaceTags as tag (tag.id)}
        <button
          class="space-tag-chip"
          class:on={library.scopedTagId === tag.id}
          title={`${tag.usageCount} note${tag.usageCount === 1 ? "" : "s"} in this space`}
          onclick={() => library.toggleScopedTag(tag.id)}
        >
          #{tag.name}
        </button>
      {/each}
    </div>
  {/if}
  {#if !library.activeWorkspaceId && !library.activeTagId && !library.revisitMode && !library.searchResults}
    <div class="status-filter">
      {#each statusFilters as f (f.id)}
        <button
          class="filter-pill"
          class:active={library.statusFilter === f.id}
          onclick={() => library.setStatusFilter(f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>
  {/if}
  {#if library.statusFilter === "trash" && library.notes.length > 0 && !library.searchResults}
    <div class="trash-bar">
      <button class="action danger" onclick={confirmEmptyTrash}>Empty Trash</button>
    </div>
  {/if}
  <div class="note-list">
    {#if library.searchResults}
      {#each library.searchResults as hit (hit.noteId)}
        <button
          class="note-row"
          data-note-id={hit.noteId}
          data-agent={agents.noteMark(hit.noteId)}
          class:selected={library.isSelected(hit.noteId)}
          onclick={(e) => rowClick(e, hit.noteId)}
        >
          <div class="row-head">
            <div class="row-title">{#each parseHighlightSegments(hit.title) as seg, i (i)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</div>
            <div class="row-date" title={formatExact(hit.updatedAt)}>{formatDate(hit.updatedAt)}</div>
          </div>
          <div class="row-preview">{#each parseHighlightSegments(hit.excerpt) as seg, i (i)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</div>
        </button>
      {:else}
        <div class="empty-state">No notes match your search.</div>
      {/each}
    {:else if syntheticNotes}
      {#each syntheticNotes as note (note.id)}
        {@const live = agentsSpace.stateOf(note.id)}
        <button
          class="note-row"
          data-note-id={note.id}
          class:selected={library.isSelected(note.id)}
          onclick={() => library.selectVirtual(note)}
        >
          <div class="row-head">
            <div class="row-title">
              {#if live}<span class="live-dot row-live" data-state={live} aria-label={live === "working" ? "Working" : "Connected"} role="img"></span>{/if}{note.title}
            </div>
            <div class="row-date" title={formatExact(note.updatedAt)}>{formatDate(note.updatedAt)}</div>
          </div>
          <div class="row-preview" class:doing={live === "working"}>{preview(note.body) || "Empty note"}</div>
        </button>
      {:else}
        <div class="empty-state">
          {#if agents.access === "off"}
            Agent access is off. Nothing can connect until you turn it on in Settings.
          {:else}
            No agent has connected yet. Connect one from Settings › Agents.
          {/if}
        </div>
      {/each}
    {:else}
      {#snippet noteRow(note: (typeof library.notes)[number])}
        <button
          class="note-row"
          data-note-id={note.id}
          data-agent={agents.noteMark(note.id)}
          class:selected={library.isSelected(note.id)}
          onclick={(e) => rowClick(e, note.id)}
          oncontextmenu={(e) => {
            if (note.isDeleted || isSyntheticSpaceId(library.activeWorkspaceId)) return;
            e.preventDefault();
            rowMenu = { x: e.clientX, y: e.clientY, id: note.id };
          }}
        >
          <div class="row-head">
          <div class="row-title">
            {#if note.isPinned}<span class="pin" aria-label="Pinned" role="img"><Icon name="pin" size={11} /></span>{/if}
            {#if note.contentKind === "whiteboard"}
              <svg class="board-cue" viewBox="0 0 16 16" aria-label="Whiteboard" role="img">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <path d="M4.5 10.5 7 7.5l2 2 2.5-3" />
              </svg>
            {/if}
            {#if library.isSticky(note.id)}
              <svg class="board-cue" viewBox="0 0 16 16" aria-label="Open as a sticky" role="img">
                <rect x="1.5" y="4.5" width="9" height="9" rx="1.5" />
                <path d="M7 2.5h5.5a1 1 0 0 1 1 1V9" />
              </svg>
            {/if}
            {note.title}
          </div>
          <div class="row-date" title={formatExact(note.updatedAt)}>{formatDate(note.updatedAt)}</div>
          </div>
          <div class="row-preview">
            {preview(note.body) || (note.contentKind === "whiteboard" ? "Empty whiteboard" : "Empty note")}
          </div>
        </button>
      {/snippet}
      {#if library.notes.length === 0}
        <div class="empty-state">
          {#if library.revisitMode}
            All caught up. Every capture has been seen.
          {:else if library.activeWorkspaceId && library.scopedTagId}
            No notes with this tag in this space.
          {:else if library.activeWorkspaceId}
            Nothing here yet. New notes land in this space while you're in it.
          {:else if library.statusFilter === "trash"}
            Trash is empty.
          {:else if library.statusFilter === "archived"}
            Nothing archived yet.
          {:else}
            No notes yet. Press {captureShortcut} anywhere to capture your first thought.
          {/if}
        </div>
      {:else if groups}
        {#each groups as group (group.label)}
          <div class="group-header section-label">{group.label}</div>
          {#each group.notes as note (note.id)}
            {@render noteRow(note)}
          {/each}
        {/each}
      {:else}
        {#each library.notes as note (note.id)}
          {@render noteRow(note)}
        {/each}
      {/if}
    {/if}
  </div>
  {/if}
</section>

{#if newMenu}
  <ContextMenu
    x={newMenu.x}
    y={newMenu.y}
    anchor={newControl}
    items={[
      { label: "New note", hint: `${modKey}N`, run: () => void library.newNote() },
      {
        label: "New whiteboard",
        hint: `${modKey}${shiftKey}N`,
        run: () => void library.newWhiteboard(),
      },
    ]}
    onclose={() => (newMenu = null)}
  />
{/if}

{#if rowMenu}
  {@const id = rowMenu.id}
  <ContextMenu
    x={rowMenu.x}
    y={rowMenu.y}
    items={library.isSticky(id)
      ? [{ label: "Bring back from sticky", run: () => void library.popIn(id) }]
      : [{ label: "Open as sticky", run: () => void library.popOut(id) }]}
    onclose={() => (rowMenu = null)}
  />
{/if}

<style>
  .list-pane {
    /* The middle surface: a step up from the page, opaque over the window. */
    background: var(--surface-list);
    border-right: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* Layout comes from .pane-header (app.css). */
  .list-toolbar {
    gap: 6px;
    padding-right: 10px;
  }
  .search {
    flex: 1;
    min-width: 0;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    outline: none;
  }
  .search:focus {
    border-color: var(--accent);
  }
  /* One object, two targets: a hairline divides the segments so the chevron
     reads as part of the ＋ button rather than a second control beside it. */
  .new-control {
    display: flex;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .new-note {
    width: 28px;
    font-size: 15px;
    color: var(--accent-text);
  }
  .new-kind {
    display: grid;
    place-items: center;
    width: 16px;
    border-left: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .new-kind svg {
    width: 8px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .new-note:hover,
  .new-kind:hover {
    background: var(--bg-hover);
  }
  .status-filter {
    display: flex;
    gap: 4px;
    padding: 0 10px 8px;
  }
  /* Occupies the status-filter's slot: the pills hide inside a space. */
  .space-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 10px 8px;
  }
  .space-tag-chip {
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    font-size: 11px;
    font-family: var(--font-meta);
    color: var(--text-secondary);
  }
  .space-tag-chip:hover {
    background: var(--bg-hover);
  }
  .space-tag-chip.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 500;
  }
  .filter-pill {
    padding: 2px 10px;
    border-radius: 99px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .filter-pill:hover {
    background: var(--bg-hover);
  }
  .filter-pill.active {
    background: var(--select-bg);
    color: var(--text);
    font-weight: 600;
  }
  .trash-bar {
    display: flex;
    justify-content: center;
    padding: 0 10px 8px;
  }
  .note-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 12px;
    border-top: 1px solid var(--border);
  }
  /* Type comes from .section-label (app.css). The label is stuck to the top
     of the list as its notes scroll under it, so it paints the list surface;
     opacity would let them show through, hence the solid colour here. */
  .group-header {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0 -8px;
    padding: 14px 18px 6px;
    background: var(--surface-list);
    opacity: 1;
    color: color-mix(in srgb, var(--text-secondary) 62%, var(--surface-list));
  }
  /* A row is the same object as a sidebar row: inset, rounded, and selected
     with the same fill. Spacing, not rules, separates one from the next. */
  .note-row {
    display: block;
    width: 100%;
    margin-bottom: 2px;
    text-align: left;
    padding: 9px 10px 10px;
    border-radius: var(--radius);
  }
  .note-row:hover {
    background: var(--bg-hover);
  }
  .note-row.selected {
    background: var(--select-bg);
  }
  /* Title and date share the first line; the date never gives way. */
  .row-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .board-cue {
    width: 12px;
    height: 12px;
    margin-right: 4px;
    vertical-align: -1px;
    fill: none;
    stroke: var(--text-tertiary);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .row-title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    display: inline-block;
    margin-right: 3px;
    vertical-align: -1px;
    color: var(--accent-text);
  }
  .row-live {
    margin-right: 6px;
  }
  /* What an agent is doing this moment, before it settles to the summary. */
  .row-preview.doing {
    color: var(--text);
  }
  /* Two lines of the note, then cut. */
  .row-preview {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.45;
    margin-top: 3px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  /* Reset UA mark styling (yellow bg, black text) so a search hit reads as
     a subtle emphasis in both themes, matching pill/tag styling elsewhere. */
  .row-title mark,
  .row-preview mark {
    background: var(--accent-soft);
    color: inherit;
    font-weight: inherit;
    border-radius: 4px;
    padding: 0 1px;
  }
  .row-date {
    flex: none;
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
    font-variant-numeric: tabular-nums;
  }
  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .agreed-mark {
    color: var(--accent-text);
    margin-right: 4px;
  }
  .action {
    padding: 4px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .action:hover {
    background: var(--bg-hover);
  }
  .action.danger {
    color: var(--danger);
  }
  .search-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    position: relative;
  }
  /* Room for the hit count, so the agent's words stop short of it. */
  .search-wrap[data-agent] .search {
    padding-right: 68px;
  }
  /* Sits inside the field's right edge, over its padding. */
  .agent-search-run {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    padding: 1px 8px;
    border-radius: 99px;
    background: var(--select-bg);
    color: var(--accent-text);
    font-family: var(--font-meta);
    font-size: 11px;
  }
</style>
