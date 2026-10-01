<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import Editor from "$lib/components/Editor.svelte";
  import FormatToolbar from "$lib/components/FormatToolbar.svelte";
  import WhiteboardCanvas from "$lib/components/whiteboard/WhiteboardCanvas.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { imagePrefs } from "$lib/stores/images.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { importImageFile, allowImageFile, openUrl, popOutNote } from "$lib/api/client";
  import { modKey, shiftKey } from "$lib/platform";
  import { theme } from "$lib/stores/theme.svelte";
  import { effectiveVariant } from "$lib/themes/apply";
  import { attachmentMarkdown } from "$lib/editor/images";
  import { formatDate, formatExact, wordCount } from "$lib/format";
  import type { FormatKind } from "$lib/markdown-format";
  import { NO_MARKS, type ActiveMarks } from "$lib/markdown-active";
  import { isVirtualNoteId } from "$lib/update/space";

  let tagInput = $state("");
  let workspaceInput = $state("");
  let editorRef = $state<{
    applyFormat: (k: FormatKind) => void;
    focus: () => void;
    insertText: (t: string) => void;
  }>();
  let active = $state<ActiveMarks>({ ...NO_MARKS });

  const isBoard = $derived(library.selected?.contentKind === "whiteboard");
  // A synthetic note (the update Space's release notes) is not user data: its
  // body can be typed in, but it has no tags, no Space, and no lifecycle.
  const isVirtual = $derived(isVirtualNoteId(library.selected?.id));
  // The board follows the app's light or dark look, including themes that
  // only come in one of the two.
  const boardTheme = $derived(effectiveVariant(theme.activeTheme, theme.resolvedVariant));

  // Insert an image from a file the user picks. Honors the storage setting:
  // "copy" reads it into the attachments folder; "link" references it in place
  // (allowed into the asset scope so it renders). Pasting or dropping still
  // captures images directly in the editor.
  async function insertImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (typeof picked !== "string") return;
    try {
      if (imagePrefs.storage === "copy") {
        const name = await importImageFile(picked);
        editorRef?.insertText(attachmentMarkdown(name));
      } else {
        await allowImageFile(picked);
        editorRef?.insertText(`![](${picked})`);
      }
    } catch (e) {
      toasts.show(`Couldn't add image. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
    // Snapshot the id when the dialog opens: the selection could otherwise
    // drift while it is up, and the confirm must act on the note it named.
    const id = library.selected?.id;
    if (!id) return;
    const ok = await confirmDialog.ask({
      title: "Delete this note permanently?",
      body: "This action cannot be undone.",
      confirmLabel: "Delete Forever",
      tone: "danger",
    });
    if (ok) await library.destroyNotes([id]);
  }
</script>

{#if library.selected && library.isSticky(library.selected.id)}
  <!-- The sticky is this note's only editor while it is out. -->
  {@const id = library.selected.id}
  <div class="popped-out">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="12" height="12" rx="2" />
      <path d="M10 4h9a2 2 0 0 1 2 2v9M13 11l7-7M15 4h5v5" />
    </svg>
    <h2>{library.selected.title || "Untitled"}</h2>
    <p>This note is open as a sticky. Edit it there, or bring it back here.</p>
    <div class="popped-actions">
      <button class="action" onclick={() => void popOutNote(id)}>Show Sticky</button>
      <button class="action primary" onclick={() => void library.popIn(id)}>Bring Back</button>
    </div>
  </div>
{:else if library.selected}
  <div class="editor-toolbar">
    <input
      class="title-input"
      value={library.selected.title}
      readonly={isVirtual}
      onchange={(e) => library.editTitle(e.currentTarget.value)}
      aria-label="Note title"
    />
    {#if !isVirtual}
    <div class="actions">
      {#if library.selected.isDeleted}
        <button class="action" onclick={() => library.restoreSelected()}>Restore</button>
        <button class="action danger" onclick={confirmDestroy}>Delete Forever</button>
      {:else}
        {#if !isBoard}
          <button
            class="action"
            title="Insert image from a file"
            onclick={insertImage}
          >
            Image
          </button>
          <button
            class="action"
            class:active={editorPrefs.toolbarOpen}
            title="Formatting tools"
            aria-pressed={editorPrefs.toolbarOpen}
            onclick={() => editorPrefs.toggleToolbar()}
          >
            Aa
          </button>
        {/if}
        <button
          class="action"
          title={`Pop out as a sticky (${modKey}${shiftKey}O)`}
          onclick={() => void library.popOut(library.selected!.id)}
        >
          Sticky
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
    {/if}
  </div>
  {#if !isVirtual}
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
          title="Remove from space"
          onclick={() => library.removeSelectedFromWorkspace(ws.id)}
          >×</button
        >
      </span>
    {/each}
    <form onsubmit={submitWorkspace}>
      <input
        class="tag-input"
        placeholder="Add to space…"
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
  {/if}
  {#if isBoard}
    <div class="editor-body board-body">
      <!-- One canvas per note: a new id mounts a fresh board. -->
      {#key library.selected.id}
        <WhiteboardCanvas
          noteId={library.selected.id}
          surfaceData={library.selected.surfaceData}
          readonly={library.selected.isDeleted}
          theme={boardTheme}
          onchange={(id, edit) => library.editBoard(id, edit)}
          registerFlush={(flush) => library.onBeforeFlush(flush)}
          onlinkopen={(url) => void openUrl(url)}
        />
      {/key}
    </div>
  {:else}
    {#if editorPrefs.toolbarOpen}
      <FormatToolbar {active} onFormat={(k) => editorRef?.applyFormat(k)} />
    {/if}
    <div
      class="editor-body"
      style="--editor-zoom: {editorPrefs.zoom}; --image-max-height: {imagePrefs.maxPreviewHeight}px"
    >
      <Editor
        bind:this={editorRef}
        value={library.selected.body}
        placeholder="Start writing… use #tags to organize"
        previewMode={!editorPrefs.toolbarOpen}
        onchange={(v) => library.editBody(v)}
        onactive={(a) => (active = a)}
      />
    </div>
  {/if}
  <div class="status-bar">
    {#if !isVirtual}
    <span
      class="save-state"
      class:saving={library.saveState === "saving"}
      class:failed={library.saveState === "failed"}
      title={formatExact(library.selected.updatedAt)}
    >
      {#if library.saveState === "saving"}<span class="save-dot"></span>Saving…{:else if library.saveState === "failed"}Not saved{:else}Saved · {editorPrefs.showExactTime ? formatExact(library.selected.updatedAt) : formatDate(library.selected.updatedAt)}{/if}
    </span>
    {/if}
    {#if library.error}
      <span class="error">{library.error}</span>
    {:else if isBoard}
      <span>Whiteboard</span>
    {:else}
      {@const n = wordCount(library.selected.body)}
      <span>{n} {n === 1 ? "word" : "words"}</span>
    {/if}
  </div>
{/if}

<style>
  .popped-out {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
  }
  .popped-out svg {
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--text-tertiary);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .popped-out h2 {
    margin: 4px 0 0;
    font-size: 16px;
    color: var(--text);
  }
  .popped-out p {
    margin: 0;
    font-size: 13px;
    max-width: 300px;
  }
  .popped-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .action.primary {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
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
  /* Retries exhausted; the edit stays queued and flushes keep attempting it. */
  .save-state.failed {
    color: var(--danger);
    font-weight: 500;
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
  .board-body {
    position: relative;
    border-top: 1px solid var(--border);
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
