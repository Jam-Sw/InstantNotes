<script lang="ts">
  import Editor from "$lib/components/Editor.svelte";
  import FormatToolbar from "$lib/components/FormatToolbar.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { formatDate, wordCount } from "$lib/format";
  import type { FormatKind } from "$lib/markdown-format";
  import { NO_MARKS, type ActiveMarks } from "$lib/markdown-active";

  let tagInput = $state("");
  let workspaceInput = $state("");
  let editorRef = $state<{ applyFormat: (k: FormatKind) => void; focus: () => void }>();
  let active = $state<ActiveMarks>({ ...NO_MARKS });

  async function submitTag(e: Event) {
    e.preventDefault();
    await library.addTag(tagInput);
    tagInput = "";
  }

  async function submitWorkspace(e: Event) {
    e.preventDefault();
    await library.addSelectedToWorkspace(workspaceInput);
    workspaceInput = "";
  }

  async function confirmDestroy() {
    if (window.confirm("Permanently delete this note? This cannot be undone.")) {
      await library.destroySelected();
    }
  }
</script>

{#if library.selected}
  <div class="editor-toolbar">
    <input
      class="title-input"
      value={library.selected.title}
      onchange={(e) => library.editTitle(e.currentTarget.value)}
      aria-label="Note title"
    />
    <div class="actions">
      {#if library.selected.isDeleted}
        <button class="action" onclick={() => library.restoreSelected()}>Restore</button>
        <button class="action danger" onclick={confirmDestroy}>Delete Forever</button>
      {:else}
        <button
          class="action"
          class:active={editorPrefs.toolbarOpen}
          title="Formatting tools"
          aria-pressed={editorPrefs.toolbarOpen}
          onclick={() => editorPrefs.toggleToolbar()}
        >
          Aa
        </button>
        <button
          class="action"
          title={library.selected.isPinned ? "Unpin" : "Pin"}
          onclick={() => library.togglePinned()}
        >
          {library.selected.isPinned ? "Unpin" : "Pin"}
        </button>
        <button class="action" onclick={() => library.toggleArchived()}>
          {library.selected.isArchived ? "Unarchive" : "Archive"}
        </button>
        <button class="action danger" onclick={() => library.deleteSelected()}>Delete</button>
      {/if}
    </div>
  </div>
  <div class="tag-bar">
    {#each library.selectedTags as tag (tag.id)}
      <span class="chip">
        #{tag.name}
        <button class="chip-remove" title="Remove tag" onclick={() => library.removeTag(tag.id)}
          >×</button
        >
      </span>
    {/each}
    <form onsubmit={submitTag}>
      <input class="tag-input" placeholder="Add tag…" bind:value={tagInput} />
    </form>
    <span class="bar-divider"></span>
    {#each library.selectedWorkspaces as ws (ws.id)}
      <span class="chip workspace-chip">
        {ws.name}
        <button
          class="chip-remove"
          title="Remove from workspace"
          onclick={() => library.removeSelectedFromWorkspace(ws.id)}
          >×</button
        >
      </span>
    {/each}
    <form onsubmit={submitWorkspace}>
      <input
        class="tag-input"
        placeholder="Add to workspace…"
        list="workspace-names"
        bind:value={workspaceInput}
      />
    </form>
    <datalist id="workspace-names">
      {#each library.workspaces as ws (ws.id)}
        <option value={ws.name}></option>
      {/each}
    </datalist>
  </div>
  {#if editorPrefs.toolbarOpen}
    <FormatToolbar {active} onFormat={(k) => editorRef?.applyFormat(k)} />
  {/if}
  <div class="editor-body" style="--editor-zoom: {editorPrefs.zoom}">
    <Editor
      bind:this={editorRef}
      value={library.selected.body}
      placeholder="Start writing… use #tags to organize"
      previewMode={!editorPrefs.toolbarOpen}
      onchange={(v) => library.editBody(v)}
      onactive={(a) => (active = a)}
    />
  </div>
  <div class="status-bar">
    <span class="save-state" class:saving={library.saving}>
      {#if library.saving}<span class="save-dot"></span>Saving…{:else}Saved · {formatDate(library.selected.updatedAt)}{/if}
    </span>
    {#if library.error}
      <span class="error">{library.error}</span>
    {:else}
      {@const n = wordCount(library.selected.body)}
      <span>{n} {n === 1 ? "word" : "words"}</span>
    {/if}
  </div>
{/if}

<style>
  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 6px;
  }
  .title-input {
    flex: 1;
    font-size: 17px;
    font-weight: 700;
    border: none;
    outline: none;
    background: transparent;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
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
  .action.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .save-state.saving {
    display: inline-flex;
    align-items: center;
    color: var(--text-secondary);
    font-style: italic;
  }
  .save-dot {
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: save-pulse 1s step-end infinite;
  }
  @keyframes save-pulse {
    50% {
      opacity: 0;
    }
  }
  .tag-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 0 16px 8px;
    border-bottom: 1px solid var(--border);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: var(--accent-soft);
    color: var(--tag);
    border-radius: 99px;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 500;
  }
  .chip-remove {
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1;
  }
  .chip-remove:hover {
    color: var(--danger);
  }
  .tag-input {
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    width: 110px;
    color: var(--text-secondary);
  }
  .bar-divider {
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .workspace-chip {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .editor-body {
    flex: 1;
    min-height: 0;
  }
  .status-bar {
    display: flex;
    justify-content: space-between;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
  .error {
    color: var(--danger);
  }
</style>
