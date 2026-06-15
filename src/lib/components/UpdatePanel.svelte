<script lang="ts">
  // Update dialog: makes the self-update explicit — current version, target
  // version, release notes, and progress — so the user always knows exactly
  // what is changing. Opened by the update pill or the tray "Check for
  // Updates…" item. Reads the `updater` store; all transitions live there.
  import { updater } from "$lib/stores/updater.svelte";

  let { open = $bindable(false), currentVersion = "" }: {
    open?: boolean;
    currentVersion?: string;
  } = $props();

  let panel = $state<HTMLDivElement>();

  // Focus the dialog when it opens so Escape and the buttons are reachable.
  $effect(() => {
    if (open) queueMicrotask(() => panel?.focus());
  });

  function close() {
    updater.dismiss();
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const pct = $derived(
    updater.progress != null ? Math.round(updater.progress * 100) : null,
  );
  const installed = $derived(updater.currentVersion ?? currentVersion);
</script>

{#if open}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    onkeydown={onKeydown}
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Software update"
      tabindex="-1"
      bind:this={panel}
    >
      {#if updater.status === "checking"}
        <h2>Checking for updates…</h2>
        <p class="muted">Looking for a newer release of InstantNotes.</p>
      {:else if updater.status === "available"}
        <h2>Update available</h2>
        <p class="version-line">
          <span class="from">v{installed}</span>
          <span class="arrow">→</span>
          <span class="to">v{updater.version}</span>
        </p>
        {#if updater.notes}
          <div class="notes-label">What's new</div>
          <pre class="notes">{updater.notes}</pre>
        {/if}
        <div class="actions">
          <button class="btn primary" onclick={() => updater.downloadAndInstall()}>
            Download &amp; Install
          </button>
          <button class="btn" onclick={close}>Later</button>
        </div>
      {:else if updater.status === "downloading"}
        <h2>Downloading update…</h2>
        <p class="version-line">Installing v{updater.version}</p>
        <div class="bar"><div class="bar-fill" style="width: {pct ?? 6}%"></div></div>
        <p class="muted">{pct != null ? `${pct}%` : "Starting…"}</p>
      {:else if updater.status === "ready"}
        <h2>Ready to restart</h2>
        <p class="muted">
          InstantNotes v{updater.version} is installed. Restart to finish updating.
        </p>
        <div class="actions">
          <button class="btn primary" onclick={() => updater.restart()}>Restart now</button>
          <button class="btn" onclick={() => (open = false)}>Later</button>
        </div>
      {:else if updater.status === "uptodate"}
        <h2>You're up to date</h2>
        <p class="muted">InstantNotes v{currentVersion} is the latest version.</p>
        <div class="actions">
          <button class="btn" onclick={close}>Close</button>
        </div>
      {:else if updater.status === "error"}
        <h2>Couldn't complete the update</h2>
        <p class="muted">Check your connection and try again.</p>
        {#if updater.error}<pre class="notes is-error">{updater.error}</pre>{/if}
        <div class="actions">
          <button class="btn primary" onclick={() => updater.checkNow({ manual: true })}>
            Try again
          </button>
          <button class="btn" onclick={close}>Close</button>
        </div>
      {:else}
        <h2>Check for updates</h2>
        <p class="muted">InstantNotes v{currentVersion}</p>
        <div class="actions">
          <button class="btn primary" onclick={() => updater.checkNow({ manual: true })}>
            Check now
          </button>
          <button class="btn" onclick={() => (open = false)}>Close</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 16vh;
    background: rgba(0, 0, 0, 0.32);
  }
  .dialog {
    width: min(460px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 22px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
    outline: none;
  }
  .dialog h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .muted {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .version-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-meta);
    font-size: 14px;
    color: var(--text);
  }
  .version-line .from {
    color: var(--text-tertiary);
  }
  .version-line .arrow {
    color: var(--text-tertiary);
  }
  .version-line .to {
    color: var(--accent);
    font-weight: 600;
  }
  .notes-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    margin-top: 4px;
  }
  .notes {
    max-height: 220px;
    overflow-y: auto;
    margin: 0;
    padding: 10px 12px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-family: var(--font-meta);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .notes.is-error {
    color: var(--danger);
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--bg-hover);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 99px;
    transition: width 0.2s ease;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
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
  .btn.primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
</style>
