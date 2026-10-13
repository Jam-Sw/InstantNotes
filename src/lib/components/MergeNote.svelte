<script lang="ts">
  import { MergeView } from "@codemirror/merge";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { library } from "$lib/stores/library.svelte";
  import { mergeSpace } from "$lib/stores/merge-space.svelte";
  import { COPIES_NOTE_ID, reasonLine } from "$lib/merge/space";
  import { formatExact, preview } from "$lib/format";

  const pair = $derived(mergeSpace.pairFor(library.selected?.id));
  const showCopies = $derived(library.selected?.id === COPIES_NOTE_ID);
  const left = $derived(pair ? mergeSpace.known[pair.a] : undefined);
  const right = $derived(pair ? mergeSpace.known[pair.b] : undefined);
  const leftBody = $derived(left?.body);
  const rightBody = $derived(right?.body);
  const title = $derived(
    showCopies ? "Exact copies combined" : left?.title || right?.title || "Untitled",
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

<div class="merge-note">
  <div class="column" class:wide={!!pair}>
    <div class="head">
      <h1 class="title">{title}</h1>
      <button
        class="btn quiet"
        disabled={busy}
        title="Empty this list and keep every note as it is now"
        onclick={() => run(() => mergeSpace.clear())}>Leave all as they are</button
      >
    </div>

    {#if showCopies}
      <p class="lead">
        These notes were on both devices, word for word, so each one is a single note now. The
        spare copy went to the Trash. Undo brings it back as its own note.
      </p>
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
      <p class="lead">
        <span class="reason">{reasonLine(pair.reason)}.</span>
        Both notes are kept until you choose. The one you don't keep goes to the Trash, where you can
        restore it.
      </p>
      <div class="both">
        <button
          class="btn primary"
          disabled={busy}
          onclick={() => run(() => mergeSpace.settle(pair, null))}>Keep both</button
        >
        <span class="both-note">Already the case. Choosing it takes the pair off this list.</span>
      </div>

      {#if left && right}
        <div class="compare">
          <div class="sides">
            <div class="side">
              <div class="side-text">
                <span class="side-name">This one</span>
                <span class="side-date">Edited {formatExact(left.updatedAt)}</span>
              </div>
              <button class="btn" disabled={busy} onclick={() => run(() => mergeSpace.settle(pair, pair.a))}
                >Keep this one</button
              >
            </div>
            <div class="side">
              <div class="side-text">
                <span class="side-name">That one</span>
                <span class="side-date">Edited {formatExact(right.updatedAt)}</span>
              </div>
              <button class="btn" disabled={busy} onclick={() => run(() => mergeSpace.settle(pair, pair.b))}
                >Keep that one</button
              >
            </div>
          </div>
          <div class="panes" bind:this={host}></div>
        </div>
      {:else}
        <p class="lead muted">One of these notes is no longer in the library. Keep both to take the pair off this list.</p>
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
  .reason {
    color: var(--text);
    font-weight: 500;
  }
  .muted {
    color: var(--text-tertiary);
  }
  .both {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }
  .both-note {
    font-size: 12.5px;
    color: var(--text-tertiary);
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
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
    padding: 10px 12px 10px 14px;
  }
  .side + .side {
    border-left: 1px solid var(--border);
  }
  @container (max-width: 560px) {
    .side {
      flex-direction: column;
      align-items: flex-start;
    }
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
