<script lang="ts">
  import { formatDate, formatExact } from "$lib/format";
  import type { RelatedNote } from "$lib/api/types";

  let {
    related,
    keepOpen = false,
    canFold,
    onOpen,
    onFold,
    onDismiss,
  }: {
    related: RelatedNote[];
    keepOpen?: boolean;
    canFold: boolean;
    onOpen: (id: string) => void;
    onFold: (note: RelatedNote) => void;
    onDismiss: (note: RelatedNote) => void;
  } = $props();

  let expandedId = $state<string | null>(null);
  let pinned = $state<RelatedNote | null>(null);
  const shown = $derived(
    pinned && expandedId === pinned.noteId && !related.some((r) => r.noteId === pinned?.noteId)
      ? [...related, pinned]
      : related,
  );
  const active = $derived(shown.find((r) => r.noteId === expandedId) ?? null);

  function close() {
    expandedId = null;
    pinned = null;
  }

  function act(run: (note: RelatedNote) => void) {
    const note = active;
    close();
    if (note) run(note);
  }

  function toggle(id: string) {
    if (active?.noteId === id) {
      close();
      return;
    }
    expandedId = id;
    pinned = related.find((r) => r.noteId === id) ?? null;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && active) {
      e.stopPropagation();
      close();
    }
  }
</script>

{#if shown.length > 0 || keepOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside class="related-strip" aria-label="Around this note" onkeydown={onKeydown}>
    {#if active}
      <div class="related-card">
        <div class="related-card-head">
          <div class="related-card-meta">
            <span class="related-card-title">{active.title || "Untitled"}</span>
            <span class="related-card-age" title={formatExact(active.updatedAt)}>
              {formatDate(active.updatedAt)}
            </span>
            {#if active.reasons.length > 0}
              <span class="related-reasons">
                {#each active.reasons as reason (reason)}
                  <span class="related-reason">{reason}</span>
                {/each}
              </span>
            {/if}
          </div>
          <div class="related-card-actions">
            {#if canFold && active.contentKind === "document"}
              <button type="button" class="related-action primary" onclick={() => act(onFold)}>
                Fold in
              </button>
            {/if}
            <button
              type="button"
              class="related-action"
              onclick={() => act((note) => onOpen(note.noteId))}
            >
              Open
            </button>
            <button
              type="button"
              class="related-dismiss"
              title="Not related"
              aria-label="Not related"
              onclick={() => act(onDismiss)}
            >
              ×
            </button>
          </div>
        </div>
        {#if active.excerpt}
          <p class="related-excerpt">{active.excerpt}</p>
        {/if}
      </div>
    {/if}
    <div class="related-bar">
      <span class="related-label" class:quiet={shown.length === 0}>Around this note</span>
      <div class="related-pills">
        {#each shown as note (note.noteId)}
          <button
            type="button"
            class="related-pill"
            class:open={active?.noteId === note.noteId}
            aria-expanded={active?.noteId === note.noteId}
            title={note.reasons.length > 0 ? `Shared: ${note.reasons.join(", ")}` : undefined}
            onclick={() => toggle(note.noteId)}
          >
            <span class="pill-title">{note.title || "Untitled"}</span>
            <span class="pill-age">{formatDate(note.updatedAt)}</span>
          </button>
        {/each}
      </div>
    </div>
  </aside>
{/if}

<style>
  .related-strip {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
  }
  .related-card {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    z-index: 2;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-sidebar);
    animation: related-rise 120ms ease-out;
  }
  @keyframes related-rise {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .related-card {
      animation: none;
    }
  }
  .related-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .related-card-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .related-card-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  }
  .related-card-age {
    font-size: 11px;
    font-family: var(--font-meta);
    color: var(--text-tertiary);
  }
  .related-reasons {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .related-reason {
    font-size: 10.5px;
    font-family: var(--font-meta);
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: 99px;
    padding: 1px 6px;
  }
  .related-card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .related-action {
    padding: 3px 9px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11.5px;
    background: var(--bg);
  }
  .related-action:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .related-action.primary {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .related-action.primary:hover {
    filter: brightness(0.98);
  }
  .related-dismiss {
    padding: 2px 6px;
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 14px;
    line-height: 1;
  }
  .related-dismiss:hover {
    background: var(--bg-hover);
    color: var(--danger);
  }
  .related-excerpt {
    margin: 6px 0 0;
    font-family: var(--font-body);
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .related-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .related-bar::-webkit-scrollbar {
    display: none;
  }
  .related-label {
    flex: none;
    font-size: 11px;
    font-family: var(--font-meta);
    color: var(--text-tertiary);
    letter-spacing: 0.01em;
  }
  .related-label.quiet {
    opacity: 0.55;
  }
  .related-pills {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .related-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 0 8px;
    border-radius: 99px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 11.5px;
    white-space: nowrap;
    max-width: 220px;
  }
  .related-pill:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .related-pill.open {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .pill-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill-age {
    flex: none;
    font-size: 10.5px;
    font-family: var(--font-meta);
    color: var(--text-tertiary);
  }
  .related-pill.open .pill-age {
    color: var(--accent-text);
    opacity: 0.8;
  }
</style>
