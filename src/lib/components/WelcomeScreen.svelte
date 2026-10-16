<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getShortcutFailure, listNotes } from "$lib/api/client";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { captureShortcut, modKey } from "$lib/platform";
  import { isWeb } from "$lib/api/runtime";
  import { layout } from "$lib/stores/layout.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { formatDate, formatExact } from "$lib/format";
  import { focusSearch } from "$lib/search-focus";
  import SearchField from "$lib/components/SearchField.svelte";
  import type { Note, ShortcutFailure } from "$lib/api/types";

  const RECENT = 5;

  let { appVersion, onOpenUpdate }: { appVersion: string; onOpenUpdate: () => void } =
    $props();

  let shortcutConflict = $state<ShortcutFailure | null>(null);
  let conflictDismissed = $state(false);

  // With the list hidden, the welcome screen carries its search and the notes
  // last opened, so a narrow window can still find and resume a note.
  const listAway = $derived(sidebar.listHidden && !layout.phone);
  let recent = $state<Note[]>([]);

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

  // Typing here opens the list on the results; the cursor follows into its field.
  function carryOver(query: string) {
    if (query.trim()) void focusSearch(document, { select: false });
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
      <div class="welcome-search">
        <SearchField onsearch={carryOver} />
      </div>
      {#if recent.length > 0}
        <section class="recent" aria-label="Continue">
          <div class="section-label">Continue</div>
          {#each recent as note (note.id)}
            <button class="recent-row" onclick={() => void library.select(note.id)}>
              <span class="recent-title">{note.title || "Untitled"}</span>
              <span class="recent-date" title={formatExact(note.lastOpenedAt!)}>{formatDate(note.lastOpenedAt!)}</span>
            </button>
          {/each}
        </section>
      {/if}
    {/if}
    {#if library.error}<p class="error">{library.error}</p>{/if}
  </div>
</div>

<style>
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
  .welcome-search,
  .recent {
    width: min(380px, calc(100vw - 48px));
    margin-inline: auto;
  }
  .welcome-search {
    display: flex;
    margin-top: 22px;
  }
  .recent {
    display: flex;
    flex-direction: column;
    margin-top: 18px;
    text-align: left;
  }
  .recent .section-label {
    padding: 0 10px 4px;
  }
  .recent-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 7px 10px;
    border-radius: var(--radius);
    color: var(--text);
    text-align: left;
  }
  .recent-row:hover,
  .recent-row:focus-visible {
    background: var(--bg-hover);
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
