<script lang="ts">
  import { openElsewhere } from "$lib/stores/open-elsewhere.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { qrDrawing } from "$lib/qr";

  let closeBtn = $state<HTMLButtonElement>();

  const link = $derived(openElsewhere.request?.link ?? null);
  const qr = $derived(link ? qrDrawing(link) : null);

  $effect(() => {
    if (openElsewhere.request) queueMicrotask(() => closeBtn?.focus());
  });

  function onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      openElsewhere.close();
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toasts.show("Copied the link.");
    } catch {
      toasts.show("Couldn't copy. Select the link and copy it instead.");
    }
  }
</script>

{#if openElsewhere.request}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) openElsewhere.close();
    }}
    onkeydown={onKeydown}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="open-elsewhere-title">
      <h2 id="open-elsewhere-title">Open on another device</h2>
      {#if link && qr}
        <p class="body">Scan this with your phone or tablet camera. It opens this note on your Sync server.</p>
        <svg
          class="qr"
          viewBox="0 0 {qr.size} {qr.size}"
          role="img"
          aria-label="Link to this note as a QR code"
          shape-rendering="crispEdges"
        >
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
        <code class="link" aria-label="Link to this note">{link}</code>
      {:else}
        <p class="body">Open this on your phone through a Sync server: Settings &gt; Sync.</p>
      {/if}
      <div class="actions">
        {#if link}
          <button class="btn" onclick={copy}>Copy link</button>
        {/if}
        <button bind:this={closeBtn} class="btn" onclick={() => openElsewhere.close()}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 130;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.32);
  }
  .dialog {
    width: min(340px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 22px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  .dialog h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .body {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .qr {
    align-self: center;
    width: 200px;
    height: 200px;
    border-radius: 4px;
  }
  .link {
    font-family: var(--font-meta);
    font-size: 12px;
    color: var(--text);
    word-break: break-all;
    user-select: all;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
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
</style>
