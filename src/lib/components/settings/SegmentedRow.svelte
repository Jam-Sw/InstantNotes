<script lang="ts">
  // A labeled segmented choice: the shared multi-option control used across
  // settings pages, matching the segmented control on the Links page.
  type Option = { value: string; label: string };
  let {
    label,
    sub = "",
    options,
    value,
    onchange,
  }: {
    label: string;
    sub?: string;
    options: Option[];
    value: string;
    onchange: (v: string) => void;
  } = $props();
</script>

<div class="pref-row">
  <span class="pref-label">
    {label}
    {#if sub}<span class="pref-sub">{sub}</span>{/if}
  </span>
  <div class="seg" role="radiogroup" aria-label={label}>
    {#each options as o (o.value)}
      <button
        class="seg-btn"
        role="radio"
        aria-checked={value === o.value}
        onclick={() => onchange(o.value)}
      >{o.label}</button>
    {/each}
  </div>
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
  .seg {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border);
  }
  .seg-btn:hover {
    background: var(--bg-hover);
  }
  .seg-btn[aria-checked="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
</style>
