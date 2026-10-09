<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    sub = "",
    subId = undefined,
    disabled = false,
    control,
  }: {
    label: string;
    sub?: string;
    subId?: string;
    disabled?: boolean;
    control: Snippet;
  } = $props();
</script>

<div class="pref-row" class:disabled>
  <span class="pref-label">
    {label}
    {#if sub}<span class="pref-sub" id={subId}>{sub}</span>{/if}
  </span>
  {@render control()}
</div>

<style>
  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .pref-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    color: var(--text);
  }
  .pref-sub {
    color: var(--text-tertiary);
    font-size: 11.5px;
  }
  .pref-row.disabled .pref-label {
    opacity: 0.5;
  }
</style>
