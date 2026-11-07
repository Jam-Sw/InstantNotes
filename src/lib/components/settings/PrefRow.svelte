<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    sub = "",
    subId = undefined,
    disabled = false,
    reset = undefined,
    control,
  }: {
    label: string;
    sub?: string;
    subId?: string;
    disabled?: boolean;
    reset?: () => void;
    control: Snippet;
  } = $props();
</script>

<div class="pref-row" class:disabled>
  <span class="pref-label">
    {label}
    {#if sub}<span class="pref-sub" id={subId}>{sub}</span>{/if}
  </span>
  {#if reset}<button class="pref-reset" type="button" {disabled} onclick={reset}>Reset</button>{/if}
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
  .pref-reset {
    margin-left: auto;
    padding: 2px 6px;
    color: var(--text-tertiary);
    font-size: 11.5px;
    border-radius: var(--radius);
  }
  .pref-reset:hover:not(:disabled) {
    color: var(--accent);
    background: var(--bg-hover);
  }
  .pref-reset:focus-visible {
    outline: 2px solid var(--accent);
  }
  .pref-row.disabled .pref-label {
    opacity: 0.5;
  }
  @media (max-width: 599px) {
    .pref-row {
      flex-wrap: wrap;
    }
  }
</style>
