<script lang="ts">
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { clientLabel, describeActivity } from "$lib/agent-activity";
  import { ApiError, deleteTag, updateTag } from "$lib/api/client";
  import { friendlyMessage, GENERIC_MESSAGE } from "$lib/errors";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import SidebarEntityRow from "$lib/components/SidebarEntityRow.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import { normalizeTagInput } from "$lib/tag-name";
  import { updateSpace } from "$lib/stores/update-space";
  import { UPDATE_SPACE_ID, UPDATE_SPACE_NAME } from "$lib/update/space";
  import { LICENSE_SPACE_NAME, licenseSpace } from "$lib/stores/license-space.svelte";
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
        e instanceof ApiError ? friendlyMessage(e.code, e.message) : GENERIC_MESSAGE;
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
        e instanceof ApiError ? friendlyMessage(e.code, e.message) : GENERIC_MESSAGE;
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
    <!-- An agent at work: who, and what, in one line that exists only while
         it is happening. The rows it touches light up on their own; this
         says in words what the light means. Opens the note it names. -->
    <div class="agent-live" role="status" aria-live="polite">
      {#if agents.current}
        {@const act = agents.current}
        <button
          class="agent-line"
          data-kind={act.status === "error" ? "error" : act.kind}
          title="An agent is working in your library. Click for the full trace."
          onclick={() => agents.openPanel()}
        >
          <span class="agent-dot" aria-hidden="true"></span>
          <span class="agent-text"
            ><strong>{clientLabel(act.client)}</strong> {describeActivity(act)}</span
          >
        </button>
      {/if}
    </div>
    <!-- The trace. Present whenever agents may connect or ever have, so the
         user always has one place to see and undo what they did. -->
    {#if agents.access !== "off" || agents.recent.length > 0}
      <button
        class="nav-item agent-nav"
        class:active={agents.panelOpen}
        title="Everything agents have read or changed, with Revert"
        onclick={() => agents.togglePanel()}
      >
        <span class="agent-nav-label">Agent activity</span>
        {#if agents.unseen > 0}
          <span class="badge" aria-label="{agents.unseen} new changes">{agents.unseen}</span>
        {/if}
      </button>
    {/if}
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
      title="Your notes, tags, and Spaces, and how they connect"
      onclick={() => library.selectGraph()}
    >
      Graph
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
    {#each library.workspaces as ws (ws.id)}
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
  .agent-line {
    display: flex;
    align-items: baseline;
    gap: 7px;
    width: 100%;
    margin: 2px 0 4px;
    padding: 4px 10px;
    border-radius: var(--radius);
    text-align: left;
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-secondary);
    animation: agent-line-in 180ms ease-out;
  }
  .agent-line:hover {
    background: var(--bg-hover);
  }
  .agent-line strong {
    color: var(--accent-text);
    font-weight: 600;
  }
  .agent-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    transform: translateY(-1px);
    animation: agent-dot 1.2s ease-in-out infinite;
  }
  .agent-line[data-kind="write"] .agent-dot {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .agent-line[data-kind="error"] .agent-dot {
    background: var(--danger);
  }
  .agent-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .agent-nav-label {
    flex: 1;
    min-width: 0;
  }
  .badge {
    flex: none;
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
  @keyframes agent-line-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  @keyframes agent-dot {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-line,
    .agent-dot {
      animation: none;
    }
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
