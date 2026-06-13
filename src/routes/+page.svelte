<script lang="ts">
  // Library window: sidebar · note list · editor (three-pane).
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import Editor from "$lib/components/Editor.svelte";
  import ThemePicker from "$lib/components/ThemePicker.svelte";
  import { library, type StatusFilter } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "trash", label: "Trash" },
  ];

  let tagInput = $state("");
  let workspaceInput = $state("");
  let newWorkspaceInput = $state("");
  let appVersion = $state("");

  onMount(() => {
    void library.init();
    void getVersion().then((v) => (appVersion = v));
    updater.start();
    const flush = () => library.flushPendingEdits();
    window.addEventListener("blur", flush);
    window.addEventListener("keydown", onKeydown);
    return () => {
      updater.stop();
      window.removeEventListener("blur", flush);
      window.removeEventListener("keydown", onKeydown);
    };
  });

  function rowClick(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey) {
      void library.toggleInSelection(id);
    } else if (e.shiftKey) {
      void library.extendSelectionTo(id);
    } else {
      void library.select(id);
    }
  }

  function isTypingTarget(t: EventTarget | null): t is HTMLElement {
    return (
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    );
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "n") {
      e.preventDefault();
      void library.newNote();
      return;
    }
    if (isTypingTarget(e.target)) {
      // Escape in the search field clears the search; everything else is typing.
      if (
        e.key === "Escape" &&
        e.target instanceof HTMLInputElement &&
        e.target.type === "search"
      ) {
        library.setSearch("");
        e.target.blur();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        void moveAndReveal(1, e.shiftKey);
        break;
      case "ArrowUp":
        e.preventDefault();
        void moveAndReveal(-1, e.shiftKey);
        break;
      case "a":
        if (mod) {
          e.preventDefault();
          void library.selectAllVisible();
        }
        break;
      case "Backspace":
        if (mod && library.multiSelected.size > 0) {
          e.preventDefault();
          void deleteSelection();
        }
        break;
      case "Escape":
        library.clearMultiSelect();
        break;
    }
  }

  // Arrow-key navigation must keep the active row visible in the list.
  async function moveAndReveal(delta: number, extend: boolean) {
    const id = await library.moveSelection(delta, extend);
    if (!id) return;
    document
      .querySelector(`.note-row[data-note-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  async function deleteSelection() {
    if (library.statusFilter === "trash") {
      await confirmBulkDestroy();
    } else {
      await library.bulkDelete();
    }
  }

  async function confirmBulkDestroy() {
    const n = library.multiSelected.size;
    const what = n === 1 ? "this note" : `these ${n} notes`;
    if (window.confirm(`Permanently delete ${what}? This cannot be undone.`)) {
      await library.bulkDestroy();
    }
  }

  async function confirmEmptyTrash() {
    if (window.confirm("Permanently delete all notes in the Trash? This cannot be undone.")) {
      await library.emptyTrash();
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function preview(body: string): string {
    return body.replace(/\s+/g, " ").trim().slice(0, 90);
  }

  function wordCount(body: string): number {
    const trimmed = body.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
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

  async function confirmDestroy() {
    if (window.confirm("Permanently delete this note? This cannot be undone.")) {
      await library.destroySelected();
    }
  }
</script>

<div class="layout">
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
    <div class="sidebar-footer">
      <ThemePicker />
    </div>
  </aside>

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

  <section class="editor-pane">
    {#if library.multiSelected.size > 1}
      {@const allPinned =
        library.multiSelectedNotes.length > 0 &&
        library.multiSelectedNotes.every((n) => n.isPinned)}
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
    {:else if library.selected}
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
      <div class="editor-body">
        <Editor
          value={library.selected.body}
          placeholder="Start writing… use #tags to organize"
          onchange={(v) => library.editBody(v)}
        />
      </div>
      <div class="status-bar">
        <span>Edited {formatDate(library.selected.updatedAt)}</span>
        {#if library.error}
          <span class="error">{library.error}</span>
        {:else}
          {@const n = wordCount(library.selected.body)}
          <span>{n} {n === 1 ? "word" : "words"}</span>
        {/if}
      </div>
    {:else}
      <div class="no-selection">
        <div class="no-selection-inner">
          <h2>
            InstantNotes
            {#if appVersion}<span class="version-badge">v{appVersion}</span>{/if}
            {#if updater.status === "available"}
              <button
                class="update-pill"
                title={`Update to v${updater.version}`}
                onclick={() => updater.downloadAndInstall()}
              >
                Update available
              </button>
            {:else if updater.status === "downloading"}
              <span class="update-pill passive">
                Downloading{updater.progress != null
                  ? ` ${Math.round(updater.progress * 100)}%`
                  : "…"}
              </span>
            {:else if updater.status === "ready"}
              <button class="update-pill" onclick={() => updater.restart()}>
                Restart to update
              </button>
            {:else if updater.status === "error"}
              <button
                class="update-pill failed"
                title={updater.error}
                onclick={() => updater.downloadAndInstall()}
              >
                Update failed, retry
              </button>
            {/if}
          </h2>
          <p>Select a note, or press <kbd>⌥Space</kbd> anywhere to capture.</p>
          {#if library.error}<p class="error">{library.error}</p>{/if}
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 190px 280px 1fr;
    height: 100vh;
    overflow: hidden;
  }

  /* sidebar */
  .sidebar {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    padding: 12px 8px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .sidebar-footer {
    margin-top: auto;
    padding-top: 8px;
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

  /* list pane */
  .list-pane {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-width: 0;
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

  /* editor pane */
  .editor-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
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

  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .no-selection-inner {
    text-align: center;
    color: var(--text-tertiary);
  }
  .no-selection-inner h2 {
    font-weight: 600;
    color: var(--text-secondary);
  }
  /* Orange marks beta builds. */
  .version-badge {
    display: inline-block;
    vertical-align: middle;
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid #e8923a;
    border-radius: 99px;
    color: #e8923a;
    background: rgba(232, 146, 58, 0.08);
    font-size: 10px;
    font-weight: 300;
    font-style: italic;
    letter-spacing: 0.3px;
  }
  /* Sits beside the version badge; same shape, accent color marks action. */
  .update-pill {
    display: inline-block;
    vertical-align: middle;
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid var(--accent);
    border-radius: 99px;
    color: var(--accent);
    background: var(--accent-soft);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.3px;
    cursor: pointer;
  }
  .update-pill.passive {
    cursor: default;
    opacity: 0.8;
  }
  .update-pill.failed {
    border-color: #d05656;
    color: #d05656;
    background: rgba(208, 86, 86, 0.08);
  }
  kbd {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-ui);
    font-size: 11px;
  }
</style>
