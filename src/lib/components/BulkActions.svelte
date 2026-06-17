<script lang="ts">
  import { library } from "$lib/stores/library.svelte";

  const allPinned = $derived(
    library.multiSelectedNotes.length > 0 &&
      library.multiSelectedNotes.every((n) => n.isPinned),
  );

  async function confirmBulkDestroy() {
    const n = library.multiSelected.size;
    const what = n === 1 ? "this note" : `these ${n} notes`;
    if (window.confirm(`Permanently delete ${what}? This cannot be undone.`)) {
      await library.bulkDestroy();
    }
  }
</script>

<div class="bulk-panel">
  <div class="bulk-inner">
    <h2>{library.multiSelected.size} notes selected</h2>
    <div class="bulk-actions">
      {#if library.statusFilter === "trash"}
        <button class="action" onclick={() => library.bulkRestore()}>Restore</button>
        <button class="action danger" onclick={confirmBulkDestroy}>Delete Forever</button>
      {:else}
        <button class="action" onclick={() => library.bulkSetPinned(!allPinned)}>
          {allPinned ? "Unpin" : "Pin"}
        </button>
        <button
          class="action"
          onclick={() => library.bulkSetArchived(library.statusFilter !== "archived")}
        >
          {library.statusFilter === "archived" ? "Unarchive" : "Archive"}
        </button>
        <button class="action danger" onclick={() => library.bulkDelete()}>Delete</button>
      {/if}
    </div>
    <p class="bulk-hint">⌘-click or ⇧-click to adjust · Esc to cancel</p>
    {#if library.error}<p class="error">{library.error}</p>{/if}
  </div>
</div>

<style>
  .bulk-panel {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .bulk-inner {
    text-align: center;
  }
  .bulk-inner h2 {
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .bulk-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .bulk-actions .action {
    font-size: 13px;
    padding: 6px 14px;
  }
  .bulk-hint {
    margin-top: 14px;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .error {
    color: var(--danger);
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
