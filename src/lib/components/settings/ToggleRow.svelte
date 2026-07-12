<script lang="ts">
  // A labeled on/off row: the shared switch control used across settings pages
  // so related toggles group together with one consistent look.
  let {
    label,
    sub = "",
    checked,
    onchange,
  }: {
    label: string;
    sub?: string;
    checked: boolean;
    onchange: (v: boolean) => void;
  } = $props();
</script>

<div class="pref-row">
  <span class="pref-label">
    {label}
    {#if sub}<span class="pref-sub">{sub}</span>{/if}
  </span>
  <button
    class="switch"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onclick={() => onchange(!checked)}
  ><span class="switch-thumb"></span></button>
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
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    transition: background 0.15s ease;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;
  }
  .switch[aria-checked="true"] .switch-thumb {
    transform: translateX(14px);
  }
</style>
