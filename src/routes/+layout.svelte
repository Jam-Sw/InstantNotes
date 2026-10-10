<script lang="ts">
  import "$lib/app.css";
  import { theme } from "$lib/stores/theme.svelte";
  let { children } = $props();

  void theme.init();

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

