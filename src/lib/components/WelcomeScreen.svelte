<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { getShortcutFailure, listNotes } from "$lib/api/client";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { captureShortcut, modKey } from "$lib/platform";
  import { isWeb } from "$lib/api/runtime";
  import { layout } from "$lib/stores/layout.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { formatDate, formatExact } from "$lib/format";
  import { parseHighlightSegments } from "$lib/highlight";
  import SearchField from "$lib/components/SearchField.svelte";
  import type { Note, ShortcutFailure } from "$lib/api/types";

  const RECENT = 5;
  const HITS = 6;

  let { appVersion, onOpenUpdate }: { appVersion: string; onOpenUpdate: () => void } =
    $props();

  let shortcutConflict = $state<ShortcutFailure | null>(null);
  let conflictDismissed = $state(false);

  // With the list not beside the editor, the welcome screen becomes a small
  // finder: the one search, its first results, or the notes last opened when
  // nothing is typed. It stays put under the list's overlay.
  const listAway = $derived(!sidebar.listInline && !layout.phone);
  let recent = $state<Note[]>([]);
  let active = $state(0);
  let results = $state<HTMLElement>();

  const query = $derived(library.searchText.trim());
  const hits = $derived(query ? (library.searchResults ?? []) : []);
  const rows = $derived(
    query
      ? hits.slice(0, HITS).map((h) => ({ id: h.noteId, title: h.title, at: h.updatedAt, excerpt: h.excerpt }))
      : recent.map((n) => ({ id: n.id, title: n.title, at: n.lastOpenedAt ?? n.updatedAt, excerpt: "" })),
  );

  async function loadRecent() {
    try {
      const notes = await listNotes({
        sortBy: "lastOpenedAt",
        sortOrder: "desc",
        limit: RECENT * 2,
        bodyChars: 0,
      });
      recent = notes.filter((n) => n.lastOpenedAt).slice(0, RECENT);
    } catch {
      recent = [];
    }
  }

  $effect(() => {
    if (!listAway) return;
    void library.notes;
    untrack(() => void loadRecent());
  });

  $effect(() => {
    void rows;
    active = 0;
  });

  function open(id: string) {
    void library.write(id);
  }

  function onSearchKey(e: KeyboardEvent) {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + rows.length) % rows.length;
      void tick().then(() =>
        results?.querySelector(".recent-row.active")?.scrollIntoView?.({ block: "nearest" }),
      );
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      open(rows[active].id);
    }
  }

  const still = () =>
    layout.resizing ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // The finder grows open, so the heading above it glides up rather than jumps.
  function reveal(node: Element) {
    const grow = slide(node, { duration: still() ? 0 : 240, easing: cubicOut });
    return { ...grow, css: (t: number, u: number) => `${grow.css?.(t, u) ?? ""}opacity: ${t};` };
  }

  onMount(() => {
    getShortcutFailure()
      .then((label) => (shortcutConflict = label))
      .catch(() => {
      });
  });
</script>

<div class="no-selection">
  <div class="no-selection-inner">
    <h2>
      InstantNotes
      {#if appVersion}<span class="version-badge">v{appVersion}</span>{/if}
      {#if updater.pendingUpdate}
        {#if updater.status === "downloading"}
          <button class="update-pill" onclick={onOpenUpdate}>
            Updating{updater.progress != null
              ? ` ${Math.round(updater.progress * 100)}%`
              : "…"}
          </button>
        {:else if updater.status === "ready"}
          <button class="update-pill" onclick={onOpenUpdate}>
            Update ready
          </button>
        {:else if updater.status === "error"}
          <button
            class="update-pill failed"
            title={updater.error}
            onclick={onOpenUpdate}
          >
            Update failed
          </button>
        {:else}
          <button
            class="update-pill"
            title={`Update available: v${updater.version}`}
            onclick={onOpenUpdate}
          >
            Update available
          </button>
        {/if}
      {/if}
    </h2>
    <p>
      Select a note{#if !isWeb && !shortcutConflict?.wayland}, or press <kbd>{captureShortcut}</kbd> anywhere to capture{/if}.
    </p>
    {#if layout.touch}
      <p class="hint-line">Tap the command button for commands and themes.</p>
    {:else}
      <p class="hint-line">Press <kbd>{modKey}K</kbd> for commands and themes.</p>
    {/if}
    {#if shortcutConflict && !conflictDismissed}
      <p class="shortcut-notice">
        {#if shortcutConflict.wayland}
          On Wayland, <kbd>{shortcutConflict.label}</kbd> only reaches InstantNotes while an X11 app is focused.
          Bind a shortcut to <code>instantnotes capture</code> in your desktop's keyboard settings instead.
        {:else}
          The capture shortcut <kbd>{shortcutConflict.label}</kbd> could not be registered;
          another app likely owns it.
        {/if}
        <button class="notice-dismiss" onclick={() => (conflictDismissed = true)}>
          Dismiss
        </button>
      </p>
    {/if}
    {#if listAway}
      <div class="finder" transition:reveal>
        <div class="welcome-search">
          <SearchField onkeydown={onSearchKey} />
        </div>
        {#if query || rows.length > 0}
          <section class="recent" aria-label={query ? "Results" : "Continue"} bind:this={results}>
            <div class="section-label">
              {#if !query}Continue{:else if library.searchResults === null}Searching…{:else if hits.length === 0}No notes match{:else}Results{/if}
            </div>
            {#each rows as row, i (row.id)}
              <button
                class="recent-row"
                class:active={i === active}
                onclick={() => open(row.id)}
                onpointermove={() => (active = i)}
              >
                <span class="recent-line">
                  <span class="recent-title">{#each parseHighlightSegments(row.title || "Untitled") as seg, k (k)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                  <span class="recent-date" title={formatExact(row.at)}>{formatDate(row.at)}</span>
                </span>
                {#if row.excerpt}
                  <span class="recent-excerpt">{#each parseHighlightSegments(row.excerpt) as seg, k (k)}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                {/if}
              </button>
            {/each}
            {#if query && library.searchResults !== null && hits.length === 0}
              <button class="recent-row" onclick={() => void library.newNote(`${query}\n`)}>
                <span class="recent-title">Start a note called “{query}”</span>
              </button>
            {/if}
            {#if hits.length > HITS}
              <button class="show-all" onclick={() => sidebar.revealList()}>
                Show all {hits.length} in the note list
              </button>
            {/if}
          </section>
        {/if}
      </div>
    {/if}
    {#if library.error}<p class="error">{library.error}</p>{/if}
  </div>
</div>

<style>
  .no-selection {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
  }
  .no-selection-inner {
    text-align: center;
    color: var(--text-tertiary);
  }
  /* A fixed height, so typing never moves the heading: results scroll inside. */
  .finder {
    display: flex;
    flex-direction: column;
    width: min(380px, calc(100vw - 48px));
    height: min(420px, 56vh);
    margin-inline: auto;
  }
  .welcome-search {
    display: flex;
    padding-top: 22px;
  }
  .recent {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-top: 18px;
    overflow-y: auto;
    text-align: left;
  }
  .recent .section-label {
    padding: 0 10px 4px;
  }
  .recent-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    border-radius: var(--radius);
    color: var(--text);
    text-align: left;
    transition: background-color 120ms ease-out;
  }
  /* The keyboard's row shows only while the search has the cursor; otherwise
     the pointer picks. */
  .recent-row:hover,
  .finder:has(:global(.search:focus)) .recent-row.active {
    background: var(--bg-hover);
  }
  .recent-line {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .recent-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-date {
    flex: none;
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .recent-excerpt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .recent-row :global(mark) {
    background: var(--accent-soft);
    color: inherit;
    border-radius: 2px;
  }
  .show-all {
    align-self: flex-start;
    margin-top: 4px;
    padding: 4px 10px;
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--accent-text);
  }
  .show-all:hover {
    background: var(--bg-hover);
  }
  .no-selection-inner h2 {
    font-weight: 600;
    color: var(--text-secondary);
  }
  .hint-line {
    font-size: 12px;
    opacity: 0.8;
  }
  .shortcut-notice {
    font-size: 12px;
    color: #e8923a;
  }
  .notice-dismiss {
    margin-left: 4px;
    border: 1px solid #e8923a;
    border-radius: 99px;
    padding: 0 7px;
    color: #e8923a;
    background: rgba(232, 146, 58, 0.08);
    font-size: 10px;
    cursor: pointer;
  }
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
    font-family: var(--font-meta);
    font-size: 11px;
  }
  .error {
    color: var(--danger);
  }
</style>
