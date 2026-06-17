<script lang="ts">
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";

  let { appVersion, onShowUpdate }: { appVersion: string; onShowUpdate: () => void } =
    $props();
</script>

<div class="no-selection">
  <div class="no-selection-inner">
    <h2>
      InstantNotes
      {#if appVersion}<span class="version-badge">v{appVersion}</span>{/if}
      {#if updater.status === "available"}
        <button
          class="update-pill"
          title={`Update available: v${updater.version}`}
          onclick={onShowUpdate}
        >
          Update available
        </button>
      {:else if updater.status === "downloading"}
        <span class="update-pill passive">
          Downloading{updater.progress != null
            ? ` ${Math.round(updater.progress * 100)}%`
            : "…"}
        </span>
      {:else if updater.status === "ready"}
        <button class="update-pill" onclick={onShowUpdate}>
          Restart to update
        </button>
      {:else if updater.status === "error"}
        <button
          class="update-pill failed"
          title={updater.error}
          onclick={onShowUpdate}
        >
          Update failed
        </button>
      {/if}
    </h2>
    <p>Select a note, or press <kbd>⌥Space</kbd> anywhere to capture.</p>
    <p class="hint-line">Press <kbd>⌘K</kbd> for commands and themes.</p>
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
  /* Orange marks beta builds. */
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
  /* Sits beside the version badge; same shape, accent color marks action. */
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
  .update-pill.passive {
    cursor: default;
    opacity: 0.8;
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
