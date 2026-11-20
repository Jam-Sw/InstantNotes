<script lang="ts">
  import { MergeView } from "@codemirror/merge";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import type { Note } from "$lib/api/types";
  import { library } from "$lib/stores/library.svelte";
  import { mergeSpace } from "$lib/stores/merge-space.svelte";
  import {
    baseTitle,
    copiedAt,
    COPIES_NOTE_ID,
    differenceLabel,
    differences,
    ownTags,
    sideNames,
    type Labels,
  } from "$lib/merge/space";
  import { formatExact, preview } from "$lib/format";

  const pair = $derived(mergeSpace.pairFor(library.selected?.id));
  const showCopies = $derived(library.selected?.id === COPIES_NOTE_ID);
  const left = $derived(pair ? mergeSpace.known[pair.a] : undefined);
  const right = $derived(pair ? mergeSpace.known[pair.b] : undefined);
  const leftLabels = $derived<Labels>((pair && mergeSpace.labels[pair.a]) || { tags: [], spaces: [] });
  const rightLabels = $derived<Labels>((pair && mergeSpace.labels[pair.b]) || { tags: [], spaces: [] });
  const names = $derived(pair ? sideNames(pair.reason) : ["", ""]);
  const diff = $derived(
    left && right && pair ? differences(left, right, leftLabels, rightLabels, pair.reason) : [],
  );
  const leftBody = $derived(left?.body);
  const rightBody = $derived(right?.body);
  const textDiffers = $derived(leftBody !== rightBody);
  const title = $derived(
    showCopies ? "Exact copies combined" : baseTitle(left?.title || right?.title || "") || "Untitled",
  );

  let busy = $state(false);
  let host = $state<HTMLDivElement>();

  const readOnly = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
  ];

  $effect(() => {
    if (!host || leftBody === undefined || rightBody === undefined) return;
    const view = new MergeView({
      a: { doc: leftBody, extensions: readOnly },
      b: { doc: rightBody, extensions: readOnly },
      parent: host,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    return () => view.destroy();
  });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }
</script>

{#snippet chips(items: string[], other: string[], prefix: string)}
  {#if items.length === 0}
    <span class="none">None</span>
  {:else}
    {#each items as item (item)}
      <span class="chip" class:only={!other.includes(item)}>{prefix}{item}</span>
    {/each}
  {/if}
{/snippet}

{#snippet side(note: Note, labels: Labels, otherLabels: Labels, name: string, otherName: string, keepId: string)}
  {@const copied = copiedAt(note.title)}
  <div class="side">
    <div class="side-head">
      <div class="side-text">
        <span class="side-name">{name}</span>
        <span class="side-date">Edited {formatExact(note.updatedAt)}</span>
        {#if copied}<span class="side-date">Copied {copied}</span>{/if}
      </div>
      <div class="side-keep">
        <button
          class="btn"
          disabled={busy}
          aria-label="Keep {name.toLowerCase()}"
          onclick={() => pair && run(() => mergeSpace.settle(pair, keepId))}>Keep</button
        >
        <span class="side-trash">{otherName} → Trash</span>
      </div>
    </div>
    {#if diff.some((d) => d !== "text")}
      <dl class="fields">
        {#if diff.includes("title")}
          <dt>Title</dt>
          <dd>{baseTitle(note.title) || "Untitled"}</dd>
        {/if}
        {#if diff.includes("tags")}
          <dt>Tags</dt>
          <dd>{@render chips(ownTags(labels), ownTags(otherLabels), "#")}</dd>
        {/if}
        {#if diff.includes("Spaces")}
          <dt>Spaces</dt>
          <dd>{@render chips(labels.spaces, otherLabels.spaces, "")}</dd>
        {/if}
        {#if diff.includes("pin")}
          <dt>Pin</dt>
          <dd>{note.isPinned ? "Pinned" : "Not pinned"}</dd>
        {/if}
        {#if diff.includes("archive")}
          <dt>Archive</dt>
          <dd>{note.isArchived ? "Archived" : "Not archived"}</dd>
        {/if}
      </dl>
    {/if}
  </div>
{/snippet}

<div class="merge-note">
  <div class="column" class:wide={!!pair}>
    <div class="head">
      <h1 class="title">{title}</h1>
      <button
        class="btn quiet"
        disabled={busy}
        onclick={() => run(() => mergeSpace.clear())}>Dismiss all</button
      >
    </div>

    {#if showCopies}
      <p class="lead">Identical, merged</p>
      <ul class="copies">
        {#each mergeSpace.review.combined as copy (copy.trashed)}
          {@const kept = mergeSpace.known[copy.kept]}
          <li class="copy">
            <div class="copy-text">
              <span class="copy-title">{kept?.title || "Untitled"}</span>
              {#if kept}<span class="copy-preview">{preview(kept.body) || "Empty note"}</span>{/if}
            </div>
            <button class="btn" disabled={busy} onclick={() => run(() => mergeSpace.undo(copy.trashed))}
              >Undo</button
            >
          </li>
        {/each}
      </ul>
    {:else if pair}
      <div class="summary">
        <span class="reason">{left && right ? differenceLabel(diff) : "One note is missing"}</span>
        <button
          class="btn primary"
          disabled={busy}
          onclick={() => run(() => mergeSpace.settle(pair, null))}>Keep both</button
        >
      </div>

      {#if left && right}
        <div class="compare">
          <div class="sides">
            {@render side(left, leftLabels, rightLabels, names[0], names[1], pair.a)}
            {@render side(right, rightLabels, leftLabels, names[1], names[0], pair.b)}
          </div>
          {#if textDiffers}
            <div class="panes" bind:this={host}></div>
          {:else}
            <div class="same">
              <span class="same-label">Text (same)</span>
              <div class="same-body">{left.body || "Empty note"}</div>
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .merge-note {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .column {
    font-size: calc(14px * var(--density));
    max-width: calc(var(--measure) + 32px * var(--density));
    margin: 0 auto;
    padding: 8px calc(16px * var(--density)) 32px;
  }
  .column.wide {
    max-width: none;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .title {
    margin: 0;
    font-size: 1.7em;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.012em;
    color: var(--text);
  }
  .lead {
    max-width: var(--measure);
    margin: 8px 0 0;
    font-size: 13px;
    line-height: var(--leading);
    color: var(--text-secondary);
  }
  .summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 10px;
  }
  .reason {
    color: var(--text);
    font-weight: 500;
  }
  .copies {
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--border);
  }
  .copy {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .copy-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .copy-title {
    font-weight: 600;
    color: var(--text);
  }
  .copy-preview {
    overflow: hidden;
    font-size: 12.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .compare {
    container-type: inline-size;
    margin-top: 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--border);
    background: var(--surface-list);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 10px 12px 12px 14px;
  }
  .side + .side {
    border-left: 1px solid var(--border);
  }
  .side-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .side-keep {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  .side-trash {
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  @container (max-width: 560px) {
    .side-head {
      flex-direction: column;
    }
    .side-keep {
      align-items: flex-start;
    }
  }
  .fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
  }
  .fields dt {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .fields dd {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    min-width: 0;
    color: var(--text);
  }
  .chip {
    padding: 0 7px;
    border-radius: 99px;
    border: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-secondary);
  }
  .chip.only {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .none {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .same {
    padding: 10px 14px 12px;
  }
  .same-label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .same-body {
    max-height: 320px;
    overflow-y: auto;
    font-family: var(--font-body);
    line-height: var(--leading);
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .side-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .side-name {
    font-weight: 600;
    color: var(--text);
  }
  .side-date {
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .btn {
    flex: none;
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 13px;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  .btn:disabled {
    opacity: 0.6;
  }
  .btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .btn.primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .btn.quiet {
    border-color: transparent;
  }
  .panes :global(.cm-mergeView) {
    font-family: var(--font-body);
  }
  .panes :global(.cm-mergeViewEditor + .cm-mergeViewEditor) {
    border-left: 1px solid var(--border);
  }
  .panes :global(.cm-editor) {
    background: var(--bg);
    color: var(--text);
  }
  .panes :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .panes :global(.cm-content) {
    padding: 10px 0;
    font-family: var(--font-body);
    line-height: var(--leading);
    caret-color: transparent;
  }
  .panes :global(.cm-line) {
    padding: 0 14px 0 10px;
  }
  .panes :global(.cm-gutters) {
    border: none;
    background: transparent;
  }
  .panes :global(.cm-editor:is(.cm-merge-a, .cm-merge-b) .cm-changedLine) {
    background: var(--accent-soft);
  }
  .panes :global(.cm-editor:is(.cm-merge-a, .cm-merge-b) .cm-changedText) {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    border-radius: 2px;
  }
  .panes :global(.cm-editor:is(.cm-merge-a, .cm-merge-b) .cm-changedLineGutter) {
    background: var(--accent);
  }
  .panes :global(.cm-editor:is(.cm-merge-a, .cm-merge-b) .cm-collapsedLines) {
    background: var(--bg-hover);
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
