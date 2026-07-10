<script lang="ts">
  // Shared confirm dialog for every irreversible action, replacing
  // window.confirm across the app. Mounted once in +page.svelte; call sites
  // just `await confirmDialog.ask(...)`. Cancel is the safe default: it holds
  // initial focus, and clicking the scrim or pressing Escape both cancel.
  import { confirmDialog } from "$lib/stores/confirm.svelte";

  let cancelBtn = $state<HTMLButtonElement>();
  let confirmBtn = $state<HTMLButtonElement>();

  $effect(() => {
    if (confirmDialog.request) {
      queueMicrotask(() => cancelBtn?.focus());
    }
  });

  function onKeydown(e: KeyboardEvent) {
    // A modal is a keyboard boundary: no key may reach the window-level
    // shortcuts underneath (+page.svelte moves the selection on ArrowUp/Down,
    // and this dialog is often about to destroy that very selection).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      confirmDialog.cancel();
      return;
    }
    // Trap Tab/Shift+Tab between the two buttons rather than letting focus
    // leave the dialog. Enter is left alone: it activates whichever button
    // already has focus, nothing more.
    if (e.key === "Tab") {
      e.preventDefault();
      const onConfirm = document.activeElement === confirmBtn;
      const next = e.shiftKey === onConfirm ? confirmBtn : cancelBtn;
      next?.focus();
    }
  }
</script>

{#if confirmDialog.request}
  {@const req = confirmDialog.request}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) confirmDialog.cancel();
    }}
    onkeydown={onKeydown}
  >
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={req.body ? "confirm-dialog-body" : undefined}
    >
      <h2 id="confirm-dialog-title">{req.title}</h2>
      {#if req.body}
        <p id="confirm-dialog-body" class="body">{req.body}</p>
      {/if}
      <div class="actions">
        <button bind:this={cancelBtn} class="btn" onclick={() => confirmDialog.cancel()}>
          {req.cancelLabel}
        </button>
        <button
          bind:this={confirmBtn}
          class="btn"
          class:danger={req.tone === "danger"}
          onclick={() => confirmDialog.confirm()}
        >
          {req.confirmLabel}
        </button>
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
    width: min(380px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
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
  .btn.danger {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--bg);
    font-weight: 500;
  }
  .btn.danger:hover {
    filter: brightness(1.08);
  }
</style>
