<script lang="ts">
  import "$lib/app.css";
  import { theme } from "$lib/stores/theme.svelte";
  let { children } = $props();

  // Apply the persisted theme as early as possible. The CSS base fallback
  // (Manuscript dark) covers first paint before this resolves.
  void theme.init();

  // Dev-only marker. Its presence proves the live dev build is loaded (it does
  // not exist in production), and the timestamp changes on every fresh load, so
  // a stale webview is immediately obvious. Compiled out of release builds.
  const buildTag = import.meta.env.DEV ? new Date().toLocaleTimeString() : "";
</script>

{@render children()}

{#if import.meta.env.DEV}
  <div class="dev-badge">dev · {buildTag}</div>
{/if}

<style>
  .dev-badge {
    position: fixed;
    bottom: 8px;
    right: 10px;
    z-index: 9999;
    padding: 2px 8px;
    border-radius: 99px;
    font-family: var(--font-meta, ui-monospace, monospace);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--accent-text, #9ccdb8);
    background: var(--accent-soft, rgba(134, 184, 163, 0.12));
    border: 1px solid var(--accent, #86b8a3);
    pointer-events: none;
    user-select: none;
  }
</style>

