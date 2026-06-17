<script lang="ts">
  import { library, type StatusFilter } from "$lib/stores/library.svelte";
  import { formatDate, preview } from "$lib/format";

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "trash", label: "Trash" },
  ];

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
    if (window.confirm("Permanently delete all notes in the Trash? This cannot be undone.")) {
      await library.emptyTrash();
    }
  }
</script>

<section class="list-pane">
  <div class="list-toolbar">
    <input
      class="search"
      type="search"
      placeholder="Search notes…"
      value={library.searchText}
      oninput={(e) => library.setSearch(e.currentTarget.value)}
    />
    <button class="new-note" title="New note (⌘N)" onclick={() => library.newNote()}>＋</button>
  </div>
  {#if !library.activeWorkspaceId && !library.activeTagId && !library.searchResults}
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
          class:selected={library.isSelected(hit.noteId)}
          onclick={(e) => rowClick(e, hit.noteId)}
        >
          <div class="row-title">{hit.title}</div>
          <div class="row-preview">{hit.excerpt}</div>
          <div class="row-date">{formatDate(hit.updatedAt)}</div>
        </button>
      {:else}
        <div class="empty-state">No notes match your search.</div>
      {/each}
    {:else}
      {#each library.notes as note (note.id)}
        <button
          class="note-row"
          data-note-id={note.id}
          class:selected={library.isSelected(note.id)}
          onclick={(e) => rowClick(e, note.id)}
        >
          <div class="row-title">
            {#if note.isPinned}<span class="pin">📌</span>{/if}
            {note.title}
          </div>
          <div class="row-preview">{preview(note.body) || "Empty note"}</div>
          <div class="row-date">{formatDate(note.updatedAt)}</div>
        </button>
      {:else}
        <div class="empty-state">
          {#if library.activeWorkspaceId}
            No notes in this workspace yet. Open a note and add it here.
          {:else if library.statusFilter === "trash"}
            Trash is empty.
          {:else if library.statusFilter === "archived"}
            Nothing archived yet.
          {:else}
            No notes yet. Press ⌥Space anywhere to capture your first thought.
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .list-pane {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .list-toolbar {
    display: flex;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }
  .search {
    flex: 1;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    outline: none;
  }
  .search:focus {
    border-color: var(--accent);
  }
  .new-note {
    width: 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 15px;
    color: var(--accent-text);
  }
  .new-note:hover {
    background: var(--bg-hover);
  }
  .status-filter {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
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
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .trash-bar {
    display: flex;
    justify-content: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .note-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .note-row {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border);
  }
  .note-row:hover {
    background: var(--bg-hover);
  }
  .note-row.selected {
    background: var(--accent-soft);
  }
  .row-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    font-size: 11px;
    margin-right: 2px;
  }
  .row-preview {
    color: var(--text-secondary);
    font-size: 12px;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-date {
    color: var(--text-tertiary);
    font-size: 11px;
    margin-top: 3px;
    font-family: var(--font-meta);
  }
  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-tertiary);
    line-height: 1.5;
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
</style>
