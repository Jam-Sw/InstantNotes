<script lang="ts">
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { agentName } from "$lib/agent-activity";
  import { deleteTag, updateTag } from "$lib/api/client";
  import { friendlyError } from "$lib/errors";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import SidebarEntityRow from "$lib/components/SidebarEntityRow.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import { normalizeTagInput } from "$lib/tag-name";
  import { updateSpace } from "$lib/stores/update-space";
  import { UPDATE_SPACE_ID, UPDATE_SPACE_NAME } from "$lib/update/space";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { AGENTS_SPACE_ID, AGENTS_SPACE_NAME } from "$lib/agents/space";
  import { LICENSE_SPACE_NAME, licenseSpace } from "$lib/stores/license-space.svelte";
  import type { TagWithCount, WorkspaceWithCount } from "$lib/api/types";
  import { spacesShown } from "$lib/spaces-shown";

  let newSpaceInput = $state("");
  let allSpaces = $state(false);
  const shownSpaces = $derived(
    allSpaces ? library.workspaces : spacesShown(library.workspaces, library.activeWorkspaceId),
  );
  const foldedSpaces = $derived(
    library.workspaces.length - spacesShown(library.workspaces, library.activeWorkspaceId).length,
  );
  let spacesHeader = $state<HTMLDivElement>();
  let tagsHeader = $state<HTMLDivElement>();
  // Space and tag management live behind a context menu (right-click /
  // Shift+F10) and double-click-to-rename, so rows carry no resting chrome.
  let renamingSpaceId = $state<string | null>(null);
  let spaceMenu = $state<{ x: number; y: number; ws: WorkspaceWithCount } | null>(null);
  let renamingTagId = $state<string | null>(null);
  let tagMenu = $state<{ x: number; y: number; tag: TagWithCount } | null>(null);

  // "Claude Code and Codex connected", "Claude Code and 19 more connected".
  const connectedTitle = $derived.by(() => {
    const names = agents.sessions.filter((s) => s.connected).map((s) => agentName(s.client, s.label));
    if (names.length === 0) return "";
    if (names.length <= 3) {
      return `${new Intl.ListFormat("en", { type: "conjunction" }).format(names)} connected`;
    }
    return `${names[0]} and ${names.length - 1} more connected`;
  });

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
      const message = friendlyError(e);
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
      const message = friendlyError(e);
      toasts.show(`Couldn't delete #${tag.name}. ${message}`);
    }
    await Promise.all([library.refreshTags(), library.refresh()]);
    // The row that held focus is gone; land somewhere stable nearby.
    queueMicrotask(() => tagsHeader?.focus());
  }
</script>

<aside class="sidebar">
  <!-- The window's title bar, where the traffic lights sit: it moves the
       window and holds nothing else. -->
  <div class="pane-header" data-tauri-drag-region></div>
  <div class="sidebar-scroll">
  {#if licenseSpace.locked}
    <!-- Until the license and EULA are agreed, the License Space is the one
         place to go; everything below is shown but out of reach. -->
    <nav class="license-nav">
      <SidebarEntityRow
        name={LICENSE_SPACE_NAME}
        count={licenseSpace.documents.length}
        normalize={(s) => s.trim()}
        noun="Space"
        active
        editing={false}
        readonly
        onSelect={() => {}}
        onStartRename={() => {}}
        onRename={async () => ({ ok: true as const })}
        onDoneRename={() => {}}
        onMenu={() => {}}
      />
    </nav>
  {/if}
  <div class="lockable" class:locked={licenseSpace.locked} inert={licenseSpace.locked}>
  <nav class="sections">
    <button
      class="nav-item"
      class:active={!library.activeWorkspaceId &&
        !library.activeTagId &&
        !library.revisitMode &&
        !library.graphMode}
      onclick={() => library.selectWorkspace(null)}
    >
      All Notes
    </button>
    <!-- Open loops: capture-born notes never opened since. Hidden at zero
         (useful by default, invisible when there's nothing to do), but held
         visible while active so the row doesn't vanish mid burn-down. -->
    {#if library.revisitCount > 0 || library.revisitMode}
      <button
        class="nav-item"
        class:active={library.revisitMode}
        title="Captured notes you've never reopened"
        onclick={() => library.selectRevisit()}
      >
        <span>Revisit</span>
        <span class="nav-count">{library.revisitCount}</span>
      </button>
    {/if}
    <button
      class="nav-item"
      class:active={library.graphMode}
      title={library.suggestionCount > 0
        ? `Your notes, tags, and Spaces, and how they connect. ${library.suggestionCount} ${library.suggestionCount === 1 ? "note" : "notes"} could be filed.`
        : "Your notes, tags, and Spaces, and how they connect"}
      onclick={() => library.selectGraph()}
    >
      <span>Graph</span>
      <!-- How many unfiled notes the graph can say a Space for. Hidden at
           zero, like Revisit: a count that reaches nothing is closure. -->
      {#if library.suggestionCount > 0}
        <span class="nav-count">{library.suggestionCount}</span>
      {/if}
    </button>
  </nav>
  <div class="tags-header section-label" bind:this={spacesHeader} tabindex="-1">Spaces</div>
  <nav class="workspaces">
    <!-- The update notification, first: the same row as any Space, with a green
         asterisk and no management gestures. It exists only while an update is
         offered, so it is rendered rather than listed. -->
    {#if updateSpace.visible}
      <SidebarEntityRow
        name={UPDATE_SPACE_NAME}
        count={updateSpace.notes.length}
        normalize={(s) => s.trim()}
        noun="Space"
        active={library.activeWorkspaceId === UPDATE_SPACE_ID}
        editing={false}
        readonly
        onSelect={() =>
          library.selectWorkspace(
            library.activeWorkspaceId === UPDATE_SPACE_ID ? null : UPDATE_SPACE_ID,
          )}
        onStartRename={() => {}}
        onRename={async () => ({ ok: true as const })}
        onDoneRename={() => {}}
        onMenu={() => {}}
      >
        {#snippet suffix()}<span class="update-star" aria-hidden="true">*</span>{/snippet}
      </SidebarEntityRow>
    {/if}
    <!-- The agent trace: a Space with one note per agent conversation, drawn
         like the update's and, like it, with no management gestures. -->
    {#if agentsSpace.visible}
      <SidebarEntityRow
        name={AGENTS_SPACE_NAME}
        count={agentsSpace.notes.length}
        normalize={(s) => s.trim()}
        noun="Space"
        active={library.activeWorkspaceId === AGENTS_SPACE_ID}
        editing={false}
        readonly
        onSelect={() =>
          library.activeWorkspaceId === AGENTS_SPACE_ID
            ? library.selectWorkspace(null)
            : agentsSpace.open()}
        onStartRename={() => {}}
        onRename={async () => ({ ok: true as const })}
        onDoneRename={() => {}}
        onMenu={() => {}}
      >
        <!-- Who is connected lives on the row itself, which is always here:
             nothing appears or goes, so nothing below it ever moves. -->
        {#snippet suffix()}{#if agents.connectedCount > 0}<span
              class="agents-live"
              title={connectedTitle}
              aria-label={connectedTitle}
              ><span class="live-dot" data-state={agents.working ? "working" : "connected"}></span>{agents.connectedCount}</span
            >{/if}{#if agents.unseen > 0}<span class="badge" aria-label="{agents.unseen} new changes">{agents.unseen}</span>{/if}{/snippet}
      </SidebarEntityRow>
    {/if}
    {#each shownSpaces as ws (ws.id)}
      <SidebarEntityRow
        name={ws.name}
        count={ws.noteCount}
        normalize={(s) => s.trim()}
        noun="Space"
        active={library.activeWorkspaceId === ws.id}
        agent={agents.spaceActive(ws.name)}
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
    {#if foldedSpaces > 0}
      <button class="spaces-more" aria-expanded={allSpaces} onclick={() => (allSpaces = !allSpaces)}>
        {allSpaces ? "Fewer" : `${foldedSpaces} more`}
      </button>
    {/if}
    <form onsubmit={submitNewSpace}>
      <input
        class="workspace-new"
        placeholder="＋ New space…"
        bind:value={newSpaceInput}
      />
    </form>
  </nav>
  <div class="tags-header section-label" bind:this={tagsHeader} tabindex="-1">Tags</div>
  <nav class="tags">
    {#each library.tags.filter((t) => t.usageCount > 0) as tag (tag.id)}
      <SidebarEntityRow
        name={tag.name}
        count={tag.usageCount}
        prefix="#"
        normalize={normalizeTagInput}
        noun="Tag"
        active={library.activeTagId === tag.id}
        agent={agents.tagActive(tag.name)}
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
  </div>
  </div>
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
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--divider);
    min-height: 0;
  }
  .sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 12px;
  }
  /* A wrapper for the lock only; it adds no box of its own. */
  .lockable {
    display: contents;
  }
  .lockable.locked > * {
    opacity: 0.4;
  }
  .license-nav {
    margin-bottom: 8px;
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
    background: var(--select-bg);
    font-weight: 600;
  }
  .agents-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 8px;
    font-family: var(--font-meta);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font-meta);
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
  /* Type comes from .section-label (app.css); this is only where it sits. */
  .tags-header {
    margin: 22px 10px 6px;
  }
  .nav-count {
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
  .nav-item.active .nav-count {
    color: var(--accent-text);
    opacity: 0.75;
  }
  .empty-hint {
    padding: 4px 10px;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  /* The notification's invitation: a saturated go-green, not the theme accent,
     so it reads as "something is ready" in every theme. */
  .update-star {
    color: #2ecc71;
    font-weight: 700;
  }

  /* spaces */
  .spaces-more {
    padding: 2px 10px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .spaces-more:hover {
    color: var(--text-secondary);
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
