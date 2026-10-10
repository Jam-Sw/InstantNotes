<script lang="ts">
  import { toasts } from "$lib/stores/toasts.svelte";
  import { fly } from "svelte/transition";

  const reduceMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flyDuration = reduceMotion ? 0 : 160;
</script>

<div class="toast-stack" role="status" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div
      class="toast"
      role="group"
      transition:fly={{ y: 10, duration: flyDuration }}
      onmouseenter={() => toasts.pause(toast.id)}
      onmouseleave={() => toasts.resume(toast.id)}
    >
      <span class="toast-message">{toast.message}</span>
      <div class="toast-actions">
        {#if toast.action}
          <button class="toast-action" onclick={() => toasts.activate(toast.id)}>
            {toast.action.label}
          </button>
        {/if}
        <button class="toast-dismiss" title="Dismiss" onclick={() => toasts.dismiss(toast.id)}>
          &times;
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 120;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(320px, 80vw);
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }
  .toast-message {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
  }
  .toast-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .toast-action {
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
  }
  .toast-action:hover {
    text-decoration: underline;
  }
  .toast-dismiss {
    color: var(--text-tertiary);
    font-size: 14px;
    line-height: 1;
  }
  .toast-dismiss:hover {
    color: var(--text);
  }
</style>
