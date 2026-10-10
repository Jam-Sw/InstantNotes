<script lang="ts">
  import PrefRow from "./PrefRow.svelte";
  let {
    label,
    sub = "",
    checked,
    disabled = false,
    onchange,
  }: {
    label: string;
    sub?: string;
    checked: boolean;
    disabled?: boolean;
    onchange: (v: boolean) => void;
  } = $props();

  const subId = $props.id();

  function flip() {
    if (disabled) return;
    onchange(!checked);
  }
</script>

<PrefRow {label} {sub} {subId} {disabled}>
  {#snippet control()}
    <button
      class="switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={sub ? subId : undefined}
      {disabled}
      onclick={flip}
    ><span class="switch-thumb"></span></button>
  {/snippet}
</PrefRow>

<style>
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
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
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
