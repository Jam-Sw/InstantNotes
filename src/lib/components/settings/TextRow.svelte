<script lang="ts">
  import PrefRow from "./PrefRow.svelte";
  let {
    label,
    value,
    placeholder = "",
    reset = undefined,
    onchange,
  }: {
    label: string;
    value: string;
    placeholder?: string;
    reset?: () => void;
    onchange: (v: string) => void;
  } = $props();
</script>

<PrefRow {label} {reset}>
  {#snippet control()}
    <input
      class="text"
      type="text"
      {value}
      {placeholder}
      aria-label={label}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      onchange={(e) => onchange(e.currentTarget.value.trim())}
    />
  {/snippet}
</PrefRow>

<style>
  .text {
    width: min(260px, 100%);
    padding: 4px 8px;
    font-size: 12.5px;
    color: var(--text);
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .text:focus-visible {
    outline: 2px solid var(--accent);
  }
  .text::placeholder {
    color: var(--text-tertiary);
  }
</style>
