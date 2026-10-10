<script lang="ts">
  import { onMount } from "svelte";
  import { getShortcutFailure } from "$lib/api/client";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { captureShortcut, modKey } from "$lib/platform";
  import type { ShortcutFailure } from "$lib/api/types";

  let { appVersion, onOpenUpdate }: { appVersion: string; onOpenUpdate: () => void } =
    $props();

  let shortcutConflict = $state<ShortcutFailure | null>(null);
  let conflictDismissed = $state(false);

  onMount(() => {
    getShortcutFailure()
      .then((label) => (shortcutConflict = label))
      .catch(() => {
      });
  });
</script>

<div class="no-selection">
  <div class="no-selection-inner">
    <h2>
      InstantNotes
      {#if appVersion}<span class="version-badge">v{appVersion}</span>{/if}
      {#if updater.pendingUpdate}
        {#if updater.status === "downloading"}
          <button class="update-pill" onclick={onOpenUpdate}>
            Updating{updater.progress != null
              ? ` ${Math.round(updater.progress * 100)}%`
              : "…"}
          </button>
        {:else if updater.status === "ready"}
          <button class="update-pill" onclick={onOpenUpdate}>
            Update ready
          </button>
        {:else if updater.status === "error"}
          <button
            class="update-pill failed"
            title={updater.error}
            onclick={onOpenUpdate}
          >
            Update failed
          </button>
        {:else}
          <button
            class="update-pill"
            title={`Update available: v${updater.version}`}
            onclick={onOpenUpdate}
          >
            Update available
          </button>
        {/if}
      {/if}
    </h2>
    <p>
      Select a note{#if !shortcutConflict?.wayland}, or press <kbd>{captureShortcut}</kbd> anywhere to capture{/if}.
    </p>
    <p class="hint-line">Press <kbd>{modKey}K</kbd> for commands and themes.</p>
    {#if shortcutConflict && !conflictDismissed}
      <p class="shortcut-notice">
        {#if shortcutConflict.wayland}
          On Wayland, <kbd>{shortcutConflict.label}</kbd> only reaches InstantNotes while an X11 app is focused.
          Bind a shortcut to <code>instantnotes capture</code> in your desktop's keyboard settings instead.
        {:else}
          The capture shortcut <kbd>{shortcutConflict.label}</kbd> could not be registered;
          another app likely owns it.
        {/if}
        <button class="notice-dismiss" onclick={() => (conflictDismissed = true)}>
          Dismiss
        </button>
      </p>
    {/if}
    {#if library.error}<p class="error">{library.error}</p>{/if}
  </div>
</div>

<style>
  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .no-selection-inner {
    text-align: center;
    color: var(--text-tertiary);
  }
  .no-selection-inner h2 {
    font-weight: 600;
    color: var(--text-secondary);
  }
  .hint-line {
    font-size: 12px;
    opacity: 0.8;
  }
  .shortcut-notice {
    font-size: 12px;
    color: #e8923a;
  }
  .notice-dismiss {
    margin-left: 4px;
    border: 1px solid #e8923a;
    border-radius: 99px;
    padding: 0 7px;
    color: #e8923a;
    background: rgba(232, 146, 58, 0.08);
    font-size: 10px;
    cursor: pointer;
  }
  .version-badge {
    display: inline-block;
    vertical-align: middle;
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid #e8923a;
    border-radius: 99px;
    color: #e8923a;
    background: rgba(232, 146, 58, 0.08);
    font-size: 10px;
    font-weight: 300;
    font-style: italic;
    letter-spacing: 0.3px;
  }
  .update-pill {
    display: inline-block;
    vertical-align: middle;
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid var(--accent);
    border-radius: 99px;
    color: var(--accent);
    background: var(--accent-soft);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.3px;
    cursor: pointer;
  }
  .update-pill.failed {
    border-color: #d05656;
    color: #d05656;
    background: rgba(208, 86, 86, 0.08);
  }
  kbd {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-meta);
    font-size: 11px;
  }
  .error {
    color: var(--danger);
  }
</style>
