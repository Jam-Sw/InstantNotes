<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import Editor from "$lib/components/Editor.svelte";
  import FormatToolbar from "$lib/components/FormatToolbar.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import WhiteboardCanvas from "$lib/components/whiteboard/WhiteboardCanvas.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
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
  <div class="pane-header" data-tauri-drag-region></div>
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
  <!-- The header holds what is done to the note, in two groups kept apart:
       what goes into the text, then what becomes of the note. The note's own
       name and where it is filed belong to the page below. -->
  <header class="pane-header editor-header" data-tauri-drag-region>
    {#if !isVirtual}
      {#if library.selected.isDeleted}
        <div class="icon-group">
          <button
            class="icon-btn"
            title="Restore from Trash"
            aria-label="Restore from Trash"
            onclick={() => library.restoreSelected()}
          >
            <Icon name="restore" />
          </button>
          <button
            class="icon-btn danger"
            title="Delete forever"
            aria-label="Delete forever"
            onclick={confirmDestroy}
          >
            <Icon name="trash" />
          </button>
        </div>
      {:else}
        {#if !isBoard}
          <div class="icon-group">
            <button
              class="icon-btn"
              title="Insert image from a file"
              aria-label="Insert image"
              onclick={insertImage}
            >
              <Icon name="image" />
            </button>
            <button
              class="icon-btn"
              title="Formatting tools"
              aria-label="Formatting tools"
              aria-pressed={editorPrefs.toolbarOpen}
              onclick={() => editorPrefs.toggleToolbar()}
            >
              <Icon name="format" />
            </button>
          </div>
        {/if}
        <div class="icon-group">
          <button
            class="icon-btn"
            title={`Pop out as a sticky (${modKey}${shiftKey}O)`}
            aria-label="Pop out as a sticky"
            onclick={() => void library.popOut(library.selected!.id)}
          >
            <Icon name="sticky" />
          </button>
          <button
            class="icon-btn"
            title={library.selected.isPinned ? "Unpin" : "Pin"}
            aria-label="Pin"
            aria-pressed={library.selected.isPinned}
            onclick={() => library.togglePinned()}
          >
            <Icon name="pin" />
          </button>
          <button
            class="icon-btn"
            title={library.selected.isArchived ? "Unarchive" : "Archive"}
            aria-label="Archive"
            aria-pressed={library.selected.isArchived}
            onclick={() => library.toggleArchived()}
          >
            <Icon name="archive" />
          </button>
          <button
            class="icon-btn danger"
            title="Move to Trash"
            aria-label="Move to Trash"
            onclick={() => library.deleteSelected()}
          >
            <Icon name="trash" />
          </button>
        </div>
      {/if}
    {/if}
  </header>
  {#if !isBoard && editorPrefs.toolbarOpen}
    <FormatToolbar {active} onFormat={(k) => editorRef?.applyFormat(k)} />
  {/if}
  <div
    class="doc"
    class:wide={isBoard}
    style="--editor-zoom: {editorPrefs.zoom}; --image-max-height: {imagePrefs.maxPreviewHeight}px"
  >
  <div class="doc-head">
    <input
      class="title-input"
      value={library.selected.title}
      readonly={isVirtual}
      onchange={(e) => library.editTitle(e.currentTarget.value)}
      aria-label="Note title"
    />
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
  </div>
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
    <div class="editor-body" data-agent={agents.noteMark(library.selected.id)}>
      <Editor
        bind:this={editorRef}
        value={library.selected.body}
        docKey={library.selected.id}
        placeholder="Start writing… use #tags to organize"
        previewMode={!editorPrefs.toolbarOpen}
        onchange={(v) => library.editBody(v)}
        onactive={(a) => (active = a)}
      />
    </div>
  {/if}
  </div>
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
  /* Layout comes from .pane-header (app.css); actions sit at the far end. */
  .editor-header {
    justify-content: flex-end;
    gap: 0;
  }
  /* The note: its name, where it is filed, then its text, all in one column
     of reading width. The column is measured in the editor's own type, so
     the heading lines up with the text at every zoom. */
  .doc {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--font-body);
    font-size: calc(14px * var(--density) * var(--editor-zoom, 1));
  }
  .doc-head {
    flex: none;
    width: 100%;
    max-width: calc(var(--measure) + 32px * var(--density));
    margin: 0 auto;
    padding: 8px calc(16px * var(--density)) 0;
  }
  /* A whiteboard runs edge to edge, so its heading does too. */
  .doc.wide .doc-head {
    max-width: none;
  }
  .title-input {
    display: block;
    width: 100%;
    padding: 0;
    font-size: 1.7em;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.012em;
    border: none;
    outline: none;
    background: transparent;
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
  /* Where the note is filed: a quiet row under its name, closed by a rule. */
  .tag-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
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
    margin-top: 10px;
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
