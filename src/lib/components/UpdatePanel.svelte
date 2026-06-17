<script lang="ts">
  // Update dialog: makes the self-update explicit — current version, target
  // version, release notes, and progress — so the user always knows exactly
  // what is changing. Opened by the update pill or the tray "Check for
  // Updates…" item. Reads the `updater` store; all transitions live there.
  import { updater, type SnoozeKind } from "$lib/stores/updater.svelte";

  let { open = $bindable(false), currentVersion = "" }: {
    open?: boolean;
    currentVersion?: string;
  } = $props();

  let panel = $state<HTMLDivElement>();
  let laterOpen = $state(false);

  // Focus the dialog when it opens so Escape and the buttons are reachable.
  $effect(() => {
    if (open) {
      laterOpen = false;
      queueMicrotask(() => panel?.focus());
    }
  });

  function close() {
    updater.dismiss();
    open = false;
  }

  // Pick a reminder cadence: snooze the update, then close the dialog.
  function snooze(kind: SnoozeKind) {
    updater.snooze(kind);
    laterOpen = false;
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
        <div class="update-header">
          <span class="app-glyph" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15201b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10" /><path d="M7 12h10" /><path d="M7 17h6" /></svg>
          </span>
          <div class="app-meta">
            <div class="app-name">InstantNotes</div>
            <div class="app-sub">A newer version is ready to install.</div>
          </div>
          <div class="ver-chips" aria-label={`Update from version ${installed} to ${updater.version}`}>
            <span class="ver from">{installed}</span>
            <svg class="ver-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13" /><path d="M13 6l6 6-6 6" /></svg>
            <span class="ver to">{updater.version}</span>
          </div>
        </div>
        {#if updater.notes}
          <div class="notes-label">What's new</div>
          <pre class="notes">{updater.notes}</pre>
        {/if}
        <div class="update-footer">
          <div class="auto-meta">Auto-update on<br />checked just now</div>
          <div class="footer-actions">
            <div class="later-wrap">
              {#if laterOpen}
                <div class="later-menu" role="menu">
                  <div class="later-head">Remind me</div>
                  <button class="later-item" role="menuitem" onclick={() => snooze("tomorrow")}>
                    Tomorrow
                  </button>
                  <button class="later-item" role="menuitem" onclick={() => snooze("week")}>
                    Next week
                  </button>
                  <button class="later-item" role="menuitem" onclick={() => snooze("launch")}>
                    On next launch
                  </button>
                </div>
              {/if}
              <button
                class="btn later-btn"
                aria-haspopup="menu"
                aria-expanded={laterOpen}
                onclick={() => (laterOpen = !laterOpen)}
              >
                Later
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            <button class="btn primary" onclick={() => updater.downloadAndInstall()}>
              Download &amp; Install
            </button>
          </div>
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
    width: min(468px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 22px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
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

  /* Polished "available" state: identity header + version-jump chips. */
  .update-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .app-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: linear-gradient(155deg, var(--accent-text) 0%, var(--accent) 100%);
    box-shadow: 0 4px 12px var(--accent-soft);
  }
  .app-meta {
    flex: 1;
    min-width: 0;
  }
  .app-name {
    font-size: 16px;
    font-weight: 660;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .app-sub {
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .ver-chips {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: none;
    font-family: var(--font-meta);
    font-size: 12px;
  }
  .ver {
    border-radius: 99px;
    padding: 2px 9px;
  }
  .ver.from {
    color: var(--text-tertiary);
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
  }
  .ver.to {
    color: var(--accent-text);
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    font-weight: 600;
  }
  .ver-arrow {
    color: var(--text-tertiary);
  }

  /* Footer: auto-update meta on the left, Later ▾ menu + primary on the right. */
  .update-footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-top: 2px;
  }
  .auto-meta {
    font-family: var(--font-meta);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-tertiary);
  }
  .footer-actions {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .later-wrap {
    position: relative;
  }
  .later-btn {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .later-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    width: 188px;
    padding: 4px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 9px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    z-index: 1;
  }
  .later-head {
    padding: 6px 10px 4px;
    font-family: var(--font-meta);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .later-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text);
  }
  .later-item:hover {
    background: var(--bg-hover);
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
