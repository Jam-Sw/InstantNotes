<script lang="ts">
  import { library } from "$lib/stores/library.svelte";
  import { ApiError, deleteTag, updateTag } from "$lib/api/client";
  import { friendlyMessage } from "$lib/errors";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import SpaceRow from "$lib/components/SpaceRow.svelte";
  import TagRow from "$lib/components/TagRow.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import type { TagWithCount, WorkspaceWithCount } from "$lib/api/types";

  let newSpaceInput = $state("");
  let spacesHeader = $state<HTMLDivElement>();
  let tagsHeader = $state<HTMLDivElement>();
  // Space and tag management live behind a context menu (right-click /
  // Shift+F10) and double-click-to-rename, so rows carry no resting chrome.
  let renamingSpaceId = $state<string | null>(null);
  let spaceMenu = $state<{ x: number; y: number; ws: WorkspaceWithCount } | null>(null);
  let renamingTagId = $state<string | null>(null);
  let tagMenu = $state<{ x: number; y: number; tag: TagWithCount } | null>(null);

  async function submitNewSpace(e: Event) {
    e.preventDefault();
    await library.createWorkspace(newSpaceInput);
    newSpaceInput = "";
  }

  // Deleting a space never touches notes, so it goes straight through with
  // an Undo toast (shown by the store) instead of a confirm dialog.
  async function deleteSpace(ws: WorkspaceWithCount): Promise<void> {
    await library.removeWorkspace(ws.id);
    // The row that held focus is gone; land somewhere stable nearby.
    queueMicrotask(() => spacesHeader?.focus());
  }

  // The tag keeps its id across a rename, so an active filter on it stays
  // valid without any extra bookkeeping here.
  async function renameTag(
    tag: TagWithCount,
    name: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await updateTag(tag.id, name);
      await Promise.all([library.refreshTags(), library.refresh()]);
      return { ok: true };
    } catch (e) {
      const message =
        e instanceof ApiError ? friendlyMessage(e.code, e.message) : friendlyMessage("");
      return { ok: false, message };
    }
  }

  async function confirmDeleteTag(tag: TagWithCount): Promise<void> {
    const notes = `${tag.usageCount} note${tag.usageCount === 1 ? "" : "s"}`;
    const ok = await confirmDialog.ask({
      title: `Delete tag "#${tag.name}"?`,
      body: `It will be removed from ${notes}; the notes are kept.`,
      confirmLabel: "Delete Tag",
      tone: "danger",
    });
    if (ok) await deleteTagRow(tag);
  }

  async function deleteTagRow(tag: TagWithCount): Promise<void> {
    // Point the filter away from the tag before it disappears, so the note
    // list is never left querying a tag id that no longer exists.
    if (library.activeTagId === tag.id) {
      library.setTagFilter(null);
    }
    try {
      await deleteTag(tag.id);
    } catch (e) {
      // The refresh below re-syncs the list, but the user completed a
      // two-step confirm; a failure must say so rather than vanish.
      const message =
        e instanceof ApiError ? friendlyMessage(e.code, e.message) : friendlyMessage("");
      toasts.show(`Couldn't delete #${tag.name}. ${message}`);
    }
    await Promise.all([library.refreshTags(), library.refresh()]);
    // The row that held focus is gone; land somewhere stable nearby.
    queueMicrotask(() => tagsHeader?.focus());
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
  <div class="tags-header" bind:this={spacesHeader} tabindex="-1">Spaces</div>
  <nav class="workspaces">
    {#each library.workspaces as ws (ws.id)}
      <SpaceRow
        workspace={ws}
        active={library.activeWorkspaceId === ws.id}
        editing={renamingSpaceId === ws.id}
        onSelect={() =>
          library.selectWorkspace(library.activeWorkspaceId === ws.id ? null : ws.id)}
        onStartRename={() => (renamingSpaceId = ws.id)}
        onRename={(name) => library.renameWorkspace(ws.id, name)}
        onDoneRename={() => (renamingSpaceId = null)}
        onMenu={(x, y) => (spaceMenu = { x, y, ws })}
      />
    {:else}
      <div class="empty-hint">A place for one project or topic</div>
    {/each}
    <form onsubmit={submitNewSpace}>
      <input
        class="workspace-new"
        placeholder="＋ New space…"
        bind:value={newSpaceInput}
      />
    </form>
  </nav>
  <div class="tags-header" bind:this={tagsHeader} tabindex="-1">Tags</div>
  <nav class="tags">
    {#each library.tags.filter((t) => t.usageCount > 0) as tag (tag.id)}
      <TagRow
        {tag}
        active={library.activeTagId === tag.id}
        editing={renamingTagId === tag.id}
        onSelect={() =>
          library.setTagFilter(library.activeTagId === tag.id ? null : tag.id)}
        onStartRename={() => (renamingTagId = tag.id)}
        onRename={(name) => renameTag(tag, name)}
        onDoneRename={() => (renamingTagId = null)}
        onMenu={(x, y) => (tagMenu = { x, y, tag })}
      />
    {:else}
      <div class="empty-hint">Type #tag in a note</div>
    {/each}
  </nav>
</aside>

{#if spaceMenu}
  {@const menuWs = spaceMenu.ws}
  <ContextMenu
    x={spaceMenu.x}
    y={spaceMenu.y}
    items={[
      { label: "Rename Space", run: () => (renamingSpaceId = menuWs.id) },
      { label: "Delete Space", danger: true, run: () => void deleteSpace(menuWs) },
    ]}
    onclose={() => (spaceMenu = null)}
  />
{/if}

{#if tagMenu}
  {@const menuTag = tagMenu.tag}
  <ContextMenu
    x={tagMenu.x}
    y={tagMenu.y}
    items={[
      { label: "Rename Tag", run: () => (renamingTagId = menuTag.id) },
      { label: "Delete Tag", danger: true, run: () => void confirmDeleteTag(menuTag) },
    ]}
    onclose={() => (tagMenu = null)}
  />
{/if}

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
  .empty-hint {
    padding: 4px 10px;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  /* spaces */
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
