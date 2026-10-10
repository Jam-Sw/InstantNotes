<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { agreements } from './agreements.svelte';

  let {
    children,
    ondecline = () => void getCurrentWindow().close(),
  }: {
    children?: import('svelte').Snippet;
    ondecline?: () => void;
  } = $props();

  let shownId = $state(agreements.pending[0] ?? agreements.documents[0]?.id);
  const shown = $derived(agreements.documents.find((d) => d.id === shownId));

  function agree() {
    if (!shown) return;
    agreements.agree(shown.id);
    const next = agreements.pending[0];
    if (next) shownId = next;
  }
</script>

{#if agreements.done}
  {@render children?.()}
{:else}
  <div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-heading">
    <div class="panel">
      <h1 id="gate-heading">{agreements.copy.heading}</h1>
      <p class="lead">{agreements.copy.lead}</p>
      <div class="tabs" role="tablist">
        {#each agreements.documents as doc (doc.id)}
          <button
            type="button"
            role="tab"
            aria-selected={doc.id === shownId}
            class:on={doc.id === shownId}
            onclick={() => (shownId = doc.id)}
          >
            {#if agreements.isAgreed(doc.id)}<span class="check" aria-label={agreements.copy.agreed}>✓</span>{/if}
            {doc.title}
          </button>
        {/each}
      </div>
      {#if shown}
        <div class="text" role="tabpanel" tabindex="0">{shown.text}</div>
        <div class="actions">
          <button type="button" onclick={ondecline}>{agreements.copy.decline}</button>
          {#if agreements.isAgreed(shown.id)}
            <span class="agreed">{agreements.copy.agreed}</span>
          {:else}
            <button type="button" class="primary" onclick={agree}>{agreements.copy.agree}</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .gate {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg, Canvas);
    color: var(--text, CanvasText);
    font-family: var(--font-ui, system-ui, sans-serif);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(720px, 100%);
    height: 100%;
    max-height: 760px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }
  .lead {
    margin: 0;
    color: var(--text-secondary, GrayText);
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border, color-mix(in srgb, CanvasText 15%, transparent));
  }
  .tabs button {
    padding: 6px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-secondary, GrayText);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--text, CanvasText);
    border-bottom-color: var(--accent, var(--text, CanvasText));
  }
  .check {
    color: var(--accent, var(--text, CanvasText));
    margin-right: 4px;
  }
  .text {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
    border: 1px solid var(--border, color-mix(in srgb, CanvasText 15%, transparent));
    border-radius: var(--radius, 8px);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .actions button {
    padding: 7px 16px;
    border-radius: var(--radius, 6px);
    border: 1px solid var(--border, color-mix(in srgb, CanvasText 25%, transparent));
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button.primary {
    background: var(--accent, CanvasText);
    border-color: var(--accent, CanvasText);
    color: var(--bg, Canvas);
    font-weight: 600;
  }
  .agreed {
    color: var(--text-secondary, GrayText);
    font-size: 13px;
  }
</style>
