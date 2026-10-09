<script lang="ts">
  import { quitApp } from "$lib/api/client";
  import { agreements } from "$lib/agreements.svelte";
  import { licenseSpace } from "$lib/stores/license-space.svelte";

  const doc = $derived(licenseSpace.shown);
  const agreed = $derived(doc ? licenseSpace.isAgreed(doc.id) : false);
</script>

{#if doc}
  <article class="license-note" aria-labelledby="license-title">
    <div class="license-toolbar">
      <h1 class="license-title" id="license-title">{doc.title}</h1>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="license-text" tabindex="0" role="document">{doc.text}</div>
    <footer class="license-foot">
      <p class="muted">{agreements.copy.lead}</p>
      <button class="btn" onclick={() => void quitApp()}>{agreements.copy.decline}</button>
      {#if agreed}
        <span class="agreed">✓ {agreements.copy.agreed}</span>
      {:else}
        <button class="btn primary" onclick={() => licenseSpace.agree(doc.id)}>
          {agreements.copy.agree}
        </button>
      {/if}
    </footer>
  </article>
{/if}

<style>
  .license-note {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .license-toolbar {
    display: flex;
    align-items: center;
    padding: 10px 16px 6px;
  }
  .license-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
  }
  .license-text {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 16px 16px;
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    user-select: text;
  }
  .license-text:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .license-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }
  .muted {
    flex: 1;
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .agreed {
    color: var(--accent-text);
    font-size: 13px;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 13px;
  }
  .btn:hover {
    background: var(--bg-hover);
  }
  .btn.primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
</style>
