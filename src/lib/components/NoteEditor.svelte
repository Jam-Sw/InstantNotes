<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import Editor from "$lib/components/Editor.svelte";
  import FormatToolbar from "$lib/components/FormatToolbar.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import WhiteboardCanvas from "$lib/components/whiteboard/WhiteboardCanvas.svelte";
  import SheetGrid from "$lib/components/sheet/SheetGrid.svelte";
  import RelatedStrip from "$lib/components/RelatedStrip.svelte";
  import { filledRows, parseSheet } from "$lib/sheet/model";
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { imagePrefs } from "$lib/stores/images.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { openElsewhere } from "$lib/stores/open-elsewhere.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import {
    dismissRelatedNote,
    importImageFile,
    openUrl,
    pickLinkedImage,
    popOutNote,
    relatedNotes,
    restoreRelatedNote,
    tagSuggestion,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import { keepOrder } from "$lib/related";
  import { debounce } from "$lib/debounce";
  import { isWeb } from "$lib/api/runtime";
  import { modKey, shiftKey } from "$lib/platform";
  import { theme } from "$lib/stores/theme.svelte";
  import { effectiveVariant } from "$lib/themes/apply";
  import { attachmentMarkdown } from "$lib/editor/images";
  import { formatDate, formatExact, wordCount } from "$lib/format";
  import type { RelatedNote, TagSuggestion } from "$lib/api/types";
  import type { FormatKind } from "$lib/markdown-format";
  import { NO_MARKS, type ActiveMarks } from "$lib/markdown-active";
  import { clientLabel } from "$lib/agent-activity";
  import { isSyntheticNoteId } from "$lib/synthetic";
  import { singleLine } from "$lib/title-field";
  import { layout } from "$lib/stores/layout.svelte";

  let tagInput = $state("");
  let workspaceInput = $state("");
  let editorRef = $state<{
    applyFormat: (k: FormatKind) => void;
    focus: (key?: string, atEnd?: boolean) => void;
    insertText: (t: string) => void;
    undo: () => void;
    redo: () => void;
  }>();
  let active = $state<ActiveMarks>({ ...NO_MARKS });
  let history = $state({ undo: false, redo: false });

  const isBoard = $derived(library.selected?.contentKind === "whiteboard");
  const isSheet = $derived(library.selected?.contentKind === "sheet");
  const isSurface = $derived(isBoard || isSheet);
  const sheetShape = $derived.by(() => {
    if (!isSheet) return null;
    const grid = parseSheet(library.selected?.surfaceData);
    return { rows: filledRows(grid), cols: grid.cols.length };
  });
  const isVirtual = $derived(isSyntheticNoteId(library.selected?.id));
  const suggestion = $derived(library.suggestions.find((s) => s.noteId === library.selected?.id));
  const lastWriter = $derived(library.selected ? agents.lastWriter(library.selected.id) : null);
  const writer = $derived(lastWriter === "instantnotes" ? null : lastWriter);
  let suggestedTag = $state<TagSuggestion | null>(null);
  let passage = $state("");
  let related = $state<RelatedNote[]>([]);
  let relatedShown = $state(false);
  let relatedToken = 0;
  let lastRelatedId: string | undefined;

  const selectedId = $derived(library.selected?.id);
  const selectedVersion = $derived(library.selected?.updatedAt);
  const selectedTagKey = $derived(library.selectedTags.map((t) => t.id).join(","));
  const noRelated = $derived(
    Boolean(isVirtual || library.selected?.isDeleted || library.selected?.isArchived),
  );

  function refreshRelated(id: string, currentPassage: string) {
    const token = ++relatedToken;
    const trimmed = currentPassage.trim();
    relatedNotes(id, trimmed || undefined).then(
      (list) => {
        if (token !== relatedToken || library.selected?.id !== id) return;
        related = keepOrder(related, list);
        if (list.length > 0) relatedShown = true;
      },
      () => {},
    );
  }

  const refreshRelatedSoon = debounce((id: string, currentPassage: string) => {
    refreshRelated(id, currentPassage);
  }, 600);

  function refreshOpenRelated() {
    const id = library.selected?.id;
    if (id && !noRelated) refreshRelated(id, passage);
  }

  $effect(() => {
    const id = selectedId;
    const currentPassage = passage;
    const excluded = noRelated;
    void selectedVersion;
    void selectedTagKey;
    if (!id || excluded || id !== lastRelatedId) {
      lastRelatedId = id;
      related = [];
      relatedShown = false;
      refreshRelatedSoon.cancel();
      if (id && !excluded) refreshRelated(id, currentPassage);
      return;
    }
    refreshRelatedSoon(id, currentPassage);
  });

  onMount(() => {
    const unlisteners: Array<() => void> = [];
    const onExternal = () => {
      const id = library.selected?.id;
      if (id && !noRelated) {
        refreshRelatedSoon(id, passage);
      }
    };
    void listen(EVENTS.SETTINGS_CHANGED, onExternal).then(
      (u) => unlisteners.push(u),
      () => {},
    );
    void listen(EVENTS.NOTES_CHANGED, onExternal).then(
      (u) => unlisteners.push(u),
      () => {},
    );
    return () => {
      refreshRelatedSoon.cancel();
      refreshTagSoon.cancel();
      for (const u of unlisteners) u();
    };
  });

  async function foldRelated(note: RelatedNote) {
    const ok = await library.foldIntoSelected(note.noteId, note.title);
    if (ok) {
      related = related.filter((r) => r.noteId !== note.noteId);
      refreshOpenRelated();
    }
  }

  async function dismissRelated(note: RelatedNote) {
    const noteId = library.selected?.id;
    if (!noteId) return;
    const title = note.title || "Untitled";
    related = related.filter((r) => r.noteId !== note.noteId);
    try {
      await dismissRelatedNote(noteId, note.noteId);
      toasts.show(`Hidden: “${title}”`, {
        label: "Undo",
        run: () => void restoreRelatedNote(noteId, note.noteId).then(refreshOpenRelated, () => {}),
      });
    } catch {
      toasts.show(`Couldn't hide “${title}”`);
    }
    refreshOpenRelated();
  }

  let tagToken = 0;
  let lastTagId: string | undefined;

  function refreshTag(id: string) {
    const token = ++tagToken;
    tagSuggestion(id).then(
      (tag) => {
        if (token === tagToken && library.selected?.id === id) suggestedTag = tag;
      },
      () => {},
    );
  }

  const refreshTagSoon = debounce((id: string) => refreshTag(id), 600);

  $effect(() => {
    const id = selectedId;
    const virtual = isVirtual;
    void selectedVersion;
    void selectedTagKey;
    if (!id || virtual || id !== lastTagId) {
      lastTagId = id;
      refreshTagSoon.cancel();
      tagToken++;
      suggestedTag = null;
      if (id && !virtual) refreshTag(id);
      return;
    }
    refreshTagSoon(id);
  });
  $effect(() => {
    const want = library.focusRequest;
    const note = library.selected;
    if (!want) return;
    if (want.id !== note?.id || isSurface || library.isSticky(want.id)) {
      library.focusRequest = null;
      return;
    }
    if (!editorRef) return;
    library.focusRequest = null;
    editorRef.focus(want.id, want.atEnd);
  });

  const boardTheme = $derived(effectiveVariant(theme.activeTheme, theme.resolvedVariant));

  async function insertImage() {
    try {
      if (imagePrefs.storage === "link") {
        const picked = await pickLinkedImage();
        if (typeof picked === "string") editorRef?.insertText(`![](${picked})`);
        return;
      }
      const picked = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (typeof picked !== "string") return;
      const name = await importImageFile(picked);
      editorRef?.insertText(attachmentMarkdown(name));
    } catch (e) {
      toasts.show(`Couldn't add image: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  type TitleEl = HTMLInputElement | HTMLTextAreaElement;

  function titleInput(e: Event & { currentTarget: TitleEl }) {
    const el = e.currentTarget;
    const flat = singleLine(el.value);
    if (flat !== el.value) el.value = flat;
    if (el.parentElement) el.parentElement.dataset.value = flat || "Untitled";
  }

  function titleKey(e: KeyboardEvent & { currentTarget: TitleEl }) {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    library.editTitle(e.currentTarget.value);
    if (!isVirtual) editorRef?.focus();
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
    const id = library.selected?.id;
    if (!id) return;
    const ok = await confirmDialog.ask({
      title: "Delete this note permanently?",
      confirmLabel: "Delete Forever",
      tone: "danger",
    });
    if (ok) await library.destroyNotes([id]);
  }
</script>

{#if library.selected && library.isSticky(library.selected.id)}
  {@const id = library.selected.id}
  <div class="pane-header" data-tauri-drag-region></div>
  <div class="popped-out">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="12" height="12" rx="2" />
      <path d="M10 4h9a2 2 0 0 1 2 2v9M13 11l7-7M15 4h5v5" />
    </svg>
    <h2>{library.selected.title || "Untitled"}</h2>
    <div class="popped-actions">
      <button class="action" onclick={() => void popOutNote(id)}>Show Sticky</button>
      <button class="action primary" onclick={() => void library.popIn(id)}>Bring Back</button>
    </div>
  </div>
{:else if library.selected}
  {#snippet titleField()}
    <div
      class="header-title"
      class:wrap={editorPrefs.titleWrap}
      data-value={library.selected?.title || "Untitled"}
    >
      {#if editorPrefs.titleWrap}
        <textarea
          class="title-input"
          rows="1"
          placeholder="Untitled"
          value={library.selected?.title}
          readonly={isVirtual}
          oninput={titleInput}
          onkeydown={titleKey}
          onchange={(e) => library.editTitle(e.currentTarget.value)}
          aria-label="Note title"
        ></textarea>
      {:else}
        <input
          class="title-input"
          size="1"
          placeholder="Untitled"
          value={library.selected?.title}
          readonly={isVirtual}
          oninput={titleInput}
          onkeydown={titleKey}
          onchange={(e) => library.editTitle(e.currentTarget.value)}
          aria-label="Note title"
        />
      {/if}
    </div>
  {/snippet}
  <header
    class="pane-header editor-header"
    class:wrap={editorPrefs.titleWrap && !layout.phone}
    data-tauri-drag-region
  >
    {#if !layout.phone}{@render titleField()}{/if}
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
        {#if !isSurface}
          <div class="icon-group">
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
            title="Open on another device"
            aria-label="Open on another device"
            onclick={() => void openElsewhere.show(library.selected!.id)}
          >
            <Icon name="devices" />
          </button>
          {#if !isWeb}
            <button
              class="icon-btn"
              title={`Pop out as a sticky (${modKey}${shiftKey}O)`}
              aria-label="Pop out as a sticky"
              onclick={() => void library.popOut(library.selected!.id)}
            >
              <Icon name="sticky" />
            </button>
          {/if}
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
  {#if !isSurface && editorPrefs.toolbarOpen && !library.selected.isDeleted}
    <FormatToolbar
      {active}
      {history}
      sourceMode={editorPrefs.sourceMode}
      onFormat={(k) => editorRef?.applyFormat(k)}
      onUndo={() => editorRef?.undo()}
      onRedo={() => editorRef?.redo()}
      onImage={isWeb || isVirtual ? undefined : insertImage}
      onToggleSource={() => editorPrefs.toggleSourceMode()}
    />
  {/if}
  <div
    class="doc"
    class:wide={isSurface}
    style="--editor-zoom: {editorPrefs.zoom}; --image-max-height: {imagePrefs.maxPreviewHeight}px"
  >
  {#if layout.phone || !isVirtual}
  <div class="doc-head">
  {#if layout.phone}{@render titleField()}{/if}
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
    {#if suggestedTag}
      <button
        class="chip suggest-chip"
        title={`${Math.round(suggestedTag.probability * 100)}% sure, from ${suggestedTag.reasons.join(", ")}`}
        onclick={() => library.addTag(suggestedTag?.tag ?? "")}
      >
        + #{suggestedTag.tag}
      </button>
    {/if}
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
    {#if suggestion}
      <button
        class="chip suggest-chip"
        onclick={() => library.addSelectedToWorkspace(suggestion.spaceName)}
      >
        + {suggestion.spaceName}
      </button>
    {/if}
    {#if writer}
      <span
        class="agent-mark"
        role="img"
        title="Last changed by {clientLabel(writer)}"
        aria-label="Last changed by {clientLabel(writer)}"
      ></span>
    {/if}
  </div>
  {/if}
  </div>
  {/if}
  {#if isBoard}
    <div class="editor-body board-body">
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
  {:else if isSheet}
    <div class="editor-body sheet-body" data-agent={agents.noteMark(library.selected.id)}>
      {#key library.selected.id}
        <SheetGrid
          noteId={library.selected.id}
          surfaceData={library.selected.surfaceData}
          readonly={library.selected.isDeleted}
          onchange={(id, surfaceData) => library.editSheet(id, surfaceData)}
          registerFlush={(flush) => library.onBeforeFlush(flush)}
        />
      {/key}
    </div>
  {:else}
    <div class="editor-body" data-agent={agents.noteMark(library.selected.id)}>
      <Editor
        bind:this={editorRef}
        value={library.selected.body}
        docKey={library.selected.id}
        placeholder="Start writing…"
        previewMode={!editorPrefs.sourceMode}
        onchange={(v) => library.editBody(v)}
        onactive={(a) => (active = a)}
        onhistory={(h) => (history = h)}
        onpassage={(p) => (passage = p)}
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
    {#if !noRelated}
      <RelatedStrip
        {related}
        keepOpen={relatedShown}
        canFold={!isSurface && !library.selected.isDeleted && !isVirtual}
        onOpen={(id) => void library.select(id)}
        onFold={(note) => void foldRelated(note)}
        onDismiss={(note) => void dismissRelated(note)}
      />
    {/if}
    {#if library.error}
      <span class="error">{library.error}</span>
    {:else if isBoard}
      <span>Whiteboard</span>
    {:else if sheetShape}
      <span>
        {sheetShape.rows} {sheetShape.rows === 1 ? "row" : "rows"} · {sheetShape.cols}
        {sheetShape.cols === 1 ? "column" : "columns"}
      </span>
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
  .editor-header {
    justify-content: flex-end;
    gap: 0;
    padding-left: calc(16px * var(--density));
  }
  .editor-header .icon-btn {
    color: var(--text-tertiary);
  }
  .editor-header .icon-btn:hover {
    color: var(--text);
  }
  .editor-header .icon-btn[aria-pressed="true"] {
    background: transparent;
    color: var(--accent-text);
  }
  .editor-header .icon-btn[aria-pressed="true"]:hover {
    background: var(--bg-hover);
  }
  .editor-header .icon-btn.danger:hover {
    color: var(--danger);
  }
  .editor-header .icon-group + .icon-group {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }
  .editor-header .icon-group + .icon-group::before {
    content: "";
    width: 1px;
    height: 16px;
    margin: 0 5px;
    background: var(--border);
  }
  .header-title {
    flex: 0 1 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    margin-right: auto;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.012em;
  }
  .header-title::after {
    content: attr(data-value) " ";
    grid-area: 1 / 1;
    visibility: hidden;
    white-space: pre;
  }
  .header-title.wrap {
    padding: 6px 0;
  }
  .header-title.wrap::after {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .editor-header.wrap {
    height: auto;
    min-height: calc(var(--chrome-h) + env(safe-area-inset-top));
  }
  .doc-head .header-title {
    padding: 10px 0 4px;
    font-size: 1.4em;
    font-weight: 700;
  }
  :global(html[data-touch]) .header-title {
    font-size: 16px;
  }
  :global(html[data-touch]) .doc-head .header-title {
    font-size: max(16px, 1.4em);
  }
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
    padding: 0 calc(16px * var(--density));
  }
  .doc.wide .doc-head {
    max-width: none;
  }
  .title-input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    color: var(--text);
    border: none;
    outline: none;
    background: transparent;
    text-overflow: ellipsis;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
  textarea.title-input {
    height: 100%;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
    padding: 2px 0 6px;
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
  .suggest-chip {
    background: transparent;
    border: 1px dashed var(--accent);
    color: var(--accent-text);
    cursor: pointer;
  }
  .suggest-chip:hover {
    background: var(--accent-soft);
  }
  .agent-mark {
    width: 8px;
    height: 8px;
    margin: 0 4px;
    border: 1.25px solid var(--accent);
    border-radius: 50%;
    opacity: 0.7;
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
  .sheet-body {
    display: flex;
    flex-direction: column;
    margin-top: 10px;
    border-top: 1px solid var(--border);
    overflow: hidden;
  }
  .status-bar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
  .status-bar > span:not(.error) {
    flex: none;
    white-space: nowrap;
  }
  .error {
    color: var(--danger);
  }
</style>
