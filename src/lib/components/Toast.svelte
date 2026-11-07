<script lang="ts">
  import { toasts } from "$lib/stores/toasts.svelte";
  import { fly } from "svelte/transition";
  import { reducedMotion } from "$lib/stores/theme.svelte";

  void toasts.init();
  const flyDuration = $derived(reducedMotion() ? 0 : 160);
</script>

<div class="toast-stack" role="status" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div
      class="toast"
      role="group"
      transition:fly={{ y: -10, duration: flyDuration }}
      onmouseenter={() => toasts.pause(toast.id)}
      onmouseleave={() => toasts.resume(toast.id)}
    >
      <span class="toast-message" title={toast.message}>{toast.message}</span>
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
    top: calc(env(safe-area-inset-top) + 8px);
    right: calc(env(safe-area-inset-right) + 208px);
    z-index: 120;
    width: max-content;
    max-width: min(520px, calc(100vw - 808px));
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  @media (max-width: 1120px) {
    .toast-stack {
      top: calc(var(--chrome-h) + env(safe-area-inset-top) + 8px);
      left: 0;
      right: 0;
      width: fit-content;
      max-width: min(520px, calc(100vw - 32px));
      margin: 0 auto;
      align-items: center;
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    padding: 6px 10px 6px 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }
  .toast-message {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.35;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
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
