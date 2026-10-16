<script lang="ts">
  import { library, type StatusFilter } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { formatDate, formatExact, preview, sheetPreview } from "$lib/format";
  import { captureShortcut, modKey, shiftKey } from "$lib/platform";
  import { isWeb } from "$lib/api/runtime";
  import { parseHighlightSegments } from "$lib/highlight";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import SearchField from "$lib/components/SearchField.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { groupNotes } from "$lib/note-groups";
  import { updateSpace } from "$lib/stores/update-space";
  import { isUpdateSpaceId } from "$lib/update/space";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { isAgentsSpaceId } from "$lib/agents/space";
  import { mergeSpace } from "$lib/stores/merge-space.svelte";
  import { isMergeSpaceId } from "$lib/merge/space";
  import { isSyntheticSpaceId } from "$lib/synthetic";
  import { agreements } from "$lib/agreements.svelte";
  import { licenseSpace } from "$lib/stores/license-space.svelte";
  import { layout } from "$lib/stores/layout.svelte";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "trash", label: "Trash" },
  ];

  const groups = $derived(
    library.revisitMode ? null : groupNotes(library.notes, new Date()),
  );

  const syntheticNotes = $derived(
    isUpdateSpaceId(library.activeWorkspaceId)
      ? updateSpace.notes
      : isAgentsSpaceId(library.activeWorkspaceId)
        ? agentsSpace.notes
        : isMergeSpaceId(library.activeWorkspaceId)
          ? mergeSpace.notes
          : null,
  );

  const query = $derived(library.searchText.trim());
  const enterTarget = $derived(
    query && library.searchResults && !library.searchResults.some((h) => library.isSelected(h.noteId))
      ? (library.searchResults[0]?.noteId ?? null)
      : null,
  );
  const workspaceName = $derived(library.workspaces.find((w) => w.id === library.activeWorkspaceId)?.name);
  const tagName = $derived(library.tags.find((t) => t.id === library.activeTagId)?.name);
  const scopedTagName = $derived(library.workspaceTags.find((t) => t.id === library.scopedTagId)?.name);

  async function onSearchKey(e: KeyboardEvent) {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const id = await library.moveSelection(e.key === "ArrowDown" ? 1 : -1);
      if (id) {
        document
          .querySelector(`.note-row[data-note-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = query;
      if (text) await library.searchNow();
      const ids = library.visibleIds;
      const open = library.selected?.id;
      const id = open && ids.includes(open) ? open : text ? ids[0] : undefined;
      if (id) await library.write(id);
    }
  }

  let newMenu = $state<{ x: number; y: number } | null>(null);
  let newControl = $state<HTMLDivElement>();

  let rowMenu = $state<{ x: number; y: number; id: string; trashed: boolean } | null>(null);

  function openNewMenu() {
    const rect = newControl?.getBoundingClientRect();
    if (!rect) return;
    newMenu = { x: rect.left, y: rect.bottom + 4 };
  }

  /** The right-clicked note, or the whole selection when it is part of one, in list order. */
  function contextTargets(id: string): string[] {
    const sel = library.multiSelected;
    if (sel.size > 1 && sel.has(id)) return library.visibleIds.filter((n) => sel.has(n));
    return [id];
  }

  async function copyContext(id: string) {
    await library.flushPendingEdits();
    try {
      await contexting.copyIds(contextTargets(id));
    } catch {
      toasts.show("Couldn't copy the context. Try again, or open the note and copy it.");
    }
  }

  function rowMenuItems(id: string, trashed: boolean) {
    const count = contextTargets(id).length;
    const items = [
      { label: count > 1 ? `Copy context (${count} notes)` : "Copy context", run: () => void copyContext(id) },
    ];
    if (trashed) {
      items.push({
        label: count > 1 ? `Restore ${count} notes` : "Restore",
        run: () => void library.restoreIds(contextTargets(id)),
      });
    } else if (!isWeb) {
      items.push(
        library.isSticky(id)
          ? { label: "Bring back from sticky", run: () => void library.popIn(id) }
          : { label: "Open as sticky", run: () => void library.popOut(id) },
      );
    }
    return items;
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
    <SearchField onkeydown={onSearchKey} />
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
      {#if library.searchResults.length > 0}
        <div class="group-header section-label" aria-live="polite">
          {library.searchResults.length} {library.searchResults.length === 1 ? "note" : "notes"}
        </div>
      {/if}
      {#each library.searchResults as hit (hit.noteId)}
        <button
          class="note-row"
          data-note-id={hit.noteId}
          data-agent={agents.noteMark(hit.noteId)}
          class:selected={library.isSelected(hit.noteId)}
          class:target={enterTarget === hit.noteId}
          onclick={(e) => rowClick(e, hit.noteId)}
        >
          <div class="row-head">
            <div class="row-title">{#each parseHighlightSegments(hit.title) as seg, i (i)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</div>
            <div class="row-date" title={formatExact(hit.updatedAt)}>{formatDate(hit.updatedAt)}</div>
          </div>
          <div class="row-preview">{#each parseHighlightSegments(hit.excerpt) as seg, i (i)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</div>
        </button>
      {:else}
        <div class="empty-state">
          <p class="empty-title">No notes match{#if query} “{query}”{/if}</p>
          {#if query}
            <button class="action primary" onclick={() => void library.newNote(`${query}\n`)}>
              Start a note called “{query}”
            </button>
          {/if}
        </div>
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
          {#if isMergeSpaceId(library.activeWorkspaceId)}
            Nothing left to review.
          {:else if agents.access === "off"}
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
            if (isSyntheticSpaceId(library.activeWorkspaceId)) return;
            e.preventDefault();
            rowMenu = { x: e.clientX, y: e.clientY, id: note.id, trashed: note.isDeleted };
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
            {:else if note.contentKind === "sheet"}
              <svg class="board-cue" viewBox="0 0 16 16" aria-label="Sheet" role="img">
                <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                <path d="M1.5 8h13M6.5 2.5v11" />
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
            {#if note.contentKind === "sheet"}
              {sheetPreview(note.body) || "Empty sheet"}
            {:else}
              {preview(note.body) || (note.contentKind === "whiteboard" ? "Empty whiteboard" : "Empty note")}
            {/if}
          </div>
        </button>
      {/snippet}
      {#if library.notes.length === 0}
        <div class="empty-state">
          {#if library.revisitMode}
            <p class="empty-title">All caught up</p>
            <p class="empty-hint">Every capture has been seen.</p>
          {:else if library.activeWorkspaceId && library.scopedTagId}
            <p class="empty-title">No {scopedTagName ? `#${scopedTagName} ` : ""}notes in this space</p>
            <button class="action" onclick={() => library.toggleScopedTag(library.scopedTagId!)}>
              Show the whole space
            </button>
          {:else if library.activeWorkspaceId}
            <p class="empty-title">Nothing in {workspaceName ?? "this space"} yet</p>
            <p class="empty-hint">New notes land in this space while you're in it.</p>
            <button class="action primary" onclick={() => void library.newNote()}>New note</button>
          {:else if library.activeTagId}
            <p class="empty-title">No notes tagged #{tagName ?? "this tag"}</p>
            <p class="empty-hint">New notes written here get the tag.</p>
            <button class="action primary" onclick={() => void library.newNote()}>New note</button>
          {:else if library.statusFilter === "trash"}
            <p class="empty-title">Trash is empty</p>
            <p class="empty-hint">Deleted notes wait here until you restore them or delete them for good.</p>
          {:else if library.statusFilter === "archived"}
            <p class="empty-title">Nothing archived</p>
            <p class="empty-hint">Archive a note to keep it without it filling your list.</p>
          {:else}
            <p class="empty-title">No notes yet</p>
            {#if !layout.touch && !isWeb}
              <p class="empty-hint">Press <kbd>{captureShortcut}</kbd> anywhere to capture a thought, or start one here.</p>
            {/if}
            <button class="action primary" onclick={() => void library.newNote()}>New note</button>
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
      { label: "New sheet", run: () => void library.newSheet() },
    ]}
    onclose={() => (newMenu = null)}
  />
{/if}

{#if rowMenu}
  <ContextMenu
    x={rowMenu.x}
    y={rowMenu.y}
    items={rowMenuItems(rowMenu.id, rowMenu.trashed)}
    onclose={() => (rowMenu = null)}
  />
{/if}

<style>
  .list-pane {
    background: var(--surface-list);
    border-right: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .list-toolbar {
    gap: 6px;
    padding-right: 10px;
  }
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
  .list-pane:has(.list-toolbar :global(.search:focus)) .note-row.target {
    background: var(--bg-hover);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .note-list > .note-row:first-child {
    margin-top: 6px;
  }
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
  .row-preview.doing {
    color: var(--text);
  }
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
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .empty-state p {
    margin: 0;
  }
  .empty-title {
    color: var(--text-secondary);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .empty-hint {
    max-width: 32ch;
    font-size: 12px;
  }
  .empty-state .action {
    margin-top: 8px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .empty-hint kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
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
  .action.primary {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--accent-text);
  }
</style>
