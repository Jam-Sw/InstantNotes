<script lang="ts">
  import { library } from "$lib/stores/library.svelte";

  let newWorkspaceInput = $state("");

  async function submitNewWorkspace(e: Event) {
    e.preventDefault();
    await library.createWorkspace(newWorkspaceInput);
    newWorkspaceInput = "";
  }

  async function confirmDeleteWorkspace(id: string, name: string) {
    if (window.confirm(`Delete workspace "${name}"? Its notes are kept.`)) {
      await library.removeWorkspace(id);
    }
  }
</script>

<aside class="sidebar">
  <nav class="sections">
    <button
      class="nav-item"
      class:active={!library.activeWorkspaceId && !library.activeTagId}
      onclick={() => library.selectWorkspace(null)}
    >
      All Notes
    </button>
  </nav>
  <div class="tags-header">Workspaces</div>
  <nav class="workspaces">
    {#each library.workspaces as ws (ws.id)}
      <div class="workspace-row">
        <button
          class="nav-item workspace-item"
          class:active={library.activeWorkspaceId === ws.id}
          onclick={() =>
            library.selectWorkspace(library.activeWorkspaceId === ws.id ? null : ws.id)}
        >
          <span class="workspace-name">{ws.name}</span>
          <span class="tag-count">{ws.noteCount}</span>
        </button>
        <button
          class="workspace-delete"
          title={`Delete workspace "${ws.name}" (notes are kept)`}
          onclick={() => confirmDeleteWorkspace(ws.id, ws.name)}
        >
          ×
        </button>
      </div>
    {:else}
      <div class="empty-hint">Group notes by project or topic</div>
    {/each}
    <form onsubmit={submitNewWorkspace}>
      <input
        class="workspace-new"
        placeholder="＋ New workspace…"
        bind:value={newWorkspaceInput}
      />
    </form>
  </nav>
  <div class="tags-header">Tags</div>
  <nav class="tags">
    {#each library.tags.filter((t) => t.usageCount > 0) as tag (tag.id)}
      <button
        class="nav-item tag-item"
        class:active={library.activeTagId === tag.id}
        onclick={() =>
          library.setTagFilter(library.activeTagId === tag.id ? null : tag.id)}
      >
        <span class="tag-name">#{tag.name}</span>
        <span class="tag-count">{tag.usageCount}</span>
      </button>
    {:else}
      <div class="empty-hint">Type #tag in a note</div>
    {/each}
  </nav>
</aside>

<style>
  /* sidebar */
  .sidebar {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    padding: 12px 8px;
    min-height: 0;
    overflow-y: auto;
  }
  .nav-item {
    display: flex;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border-radius: var(--radius);
    color: var(--text);
  }
  .nav-item:hover {
    background: var(--bg-hover);
  }
  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .tags-header {
    margin: 16px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-count {
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
  .empty-hint {
    padding: 4px 10px;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  /* workspaces */
  .workspace-row {
    display: flex;
    align-items: center;
  }
  .workspace-row .nav-item {
    min-width: 0;
  }
  .workspace-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .workspace-delete {
    flex-shrink: 0;
    width: 18px;
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1;
    visibility: hidden;
  }
  .workspace-row:hover .workspace-delete {
    visibility: visible;
  }
  .workspace-delete:hover {
    color: var(--danger);
  }
  .workspace-new {
    width: 100%;
    margin-top: 2px;
    padding: 4px 10px;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .workspace-new::placeholder {
    color: var(--text-tertiary);
  }
</style>
