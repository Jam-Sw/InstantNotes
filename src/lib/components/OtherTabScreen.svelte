<script lang="ts">
  import { tab } from "$lib/web/tab.svelte";

  let useBtn = $state<HTMLButtonElement>();

  $effect(() => {
    if (tab.elsewhere) queueMicrotask(() => useBtn?.focus());
  });

  function onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Tab" || e.key === "Escape") {
      e.preventDefault();
      useBtn?.focus();
    }
  }
</script>

{#if tab.elsewhere}
  <div
    class="screen"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="other-tab-title"
    aria-describedby="other-tab-body"
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <div class="inner">
      <div class="tabs" aria-hidden="true">
        <span class="tab here"></span>
        <span class="tab there"></span>
      </div>
      <h2 id="other-tab-title">InstantNotes is open in another tab.</h2>
      <p id="other-tab-body">
        Your notes can be open in one tab at a time. Use them here and the other tab will show this
        message instead.
      </p>
      <button bind:this={useBtn} class="btn" onclick={() => tab.useHere()}>Use here</button>
    </div>
  </div>
{/if}

<style>
  .screen {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 24px 16px 12vh;
    background: var(--bg);
    color: var(--text);
  }
  .screen:focus {
    outline: none;
  }
  .inner {
    width: min(360px, 100%);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    width: 100%;
    margin-bottom: 22px;
    border-bottom: 1px solid var(--divider);
  }
  .tab {
    width: 72px;
    height: 20px;
    border-radius: 6px 6px 0 0;
  }
  .tab.here {
    margin-bottom: -1px;
    height: 21px;
    border: 1px solid var(--divider);
    border-bottom: none;
    background: var(--bg);
  }
  .tab.there {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    background: var(--bg-hover);
  }
  .tab.there::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.35;
  }
  p {
    margin: 8px 0 20px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 500;
  }
  .btn:hover {
    filter: brightness(1.08);
  }
</style>
