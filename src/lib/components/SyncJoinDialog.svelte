<script lang="ts">
  import { onMount } from "svelte";
  import { answerSyncJoin, listSyncJoinRequests } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import type { SyncJoinRequest } from "$lib/api/types";
  import { toasts } from "$lib/stores/toasts.svelte";

  let requests = $state<SyncJoinRequest[]>([]);
  let busy = $state(false);
  let dialog = $state<HTMLDivElement>();
  let denyBtn = $state<HTMLButtonElement>();
  let approveBtn = $state<HTMLButtonElement>();
  let invoker: HTMLElement | null = null;
  const answered = new Set<string>();

  const current = $derived(requests[0]);
  const waiting = $derived(requests.length - 1);
  const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

  onMount(() => {
    let heard = false;
    const unlisten = listen<SyncJoinRequest[] | null>(EVENTS.SYNC_JOIN_REQUESTS, (e) => {
      heard = true;
      requests = (e.payload ?? []).filter((r) => !answered.has(r.id));
    });
    listSyncJoinRequests()
      .then((found) => {
        if (!heard) requests = found.filter((r) => !answered.has(r.id));
      })
      .catch(() => {});
    return () => void unlisten.then((off) => off());
  });

  let shownId: string | undefined;
  $effect(() => {
    const id = current?.id;
    if (id === shownId) return;
    if (!shownId && id) {
      invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    shownId = id;
    if (id) {
      queueMicrotask(() => dialog?.focus());
    } else {
      const back = invoker;
      invoker = null;
      queueMicrotask(() => back?.focus());
    }
  });

  async function answer(approve: boolean) {
    const req = current;
    if (!req || busy) return;
    busy = true;
    try {
      await answerSyncJoin(req.id, req.publicKey, approve);
      answered.add(req.id);
      requests = requests.filter((r) => r.id !== req.id);
    } catch (e) {
      toasts.show(
        approve
          ? `Couldn't approve ${req.deviceName}: ${errorMessage(e)}`
          : `Couldn't deny ${req.deviceName}: ${errorMessage(e)}`,
      );
    } finally {
      busy = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const onApprove = document.activeElement === approveBtn;
      const onDeny = document.activeElement === denyBtn;
      const next = onDeny ? approveBtn : onApprove ? denyBtn : e.shiftKey ? approveBtn : denyBtn;
      next?.focus();
    }
  }
</script>

{#if current}
  <div class="overlay" role="presentation" onkeydown={onKeydown}>
    <div
      bind:this={dialog}
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sync-join-title"
      aria-describedby="sync-join-body"
      tabindex="-1"
    >
      <h2 id="sync-join-title"><strong>{current.deviceName}</strong> wants to join.</h2>
      <p id="sync-join-body" class="body">Do these words match the ones on it?</p>
      <ol class="words" aria-label="Words">
        {#each current.words as word, i (i)}
          <li><span class="n" aria-hidden="true">{i + 1}</span><span class="word">{word}</span></li>
        {/each}
      </ol>
      <div class="foot">
        {#if waiting > 0}
          <p class="more">{waiting === 1 ? "1 more device waiting" : `${waiting} more devices waiting`}</p>
        {/if}
        <div class="actions">
          <button bind:this={denyBtn} class="btn" disabled={busy} onclick={() => answer(false)}>
            Deny
          </button>
          <button
            bind:this={approveBtn}
            class="btn primary"
            disabled={busy}
            onclick={() => answer(true)}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 135;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.32);
  }
  .dialog {
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px 22px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  .dialog:focus {
    outline: none;
  }
  .dialog h2,
  .dialog p {
    margin: 0;
  }
  .dialog h2 {
    font-size: 15px;
    font-weight: 400;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .dialog h2 strong {
    font-weight: 600;
  }
  .body {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .words {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    margin: 10px 0 4px;
    padding: 0;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .words li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 12px 13px;
    background: var(--surface-list);
  }
  .n {
    flex: none;
    min-width: 0.8em;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }
  .word {
    min-width: 0;
    font-size: 20px;
    font-weight: 500;
    line-height: 1.2;
    color: var(--text);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .more {
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 13px;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .btn:disabled {
    opacity: 0.6;
  }
  .btn.primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  @media (max-width: 480px) {
    .dialog {
      padding: 18px 16px;
    }
    .words {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
