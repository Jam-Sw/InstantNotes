<script lang="ts">
  import PrefRow from "./PrefRow.svelte";
  import { pickFile } from "$lib/folder-picker";
  import { toasts } from "$lib/stores/toasts.svelte";
  let {
    label,
    value,
    extensions,
    reset = undefined,
    onchange,
  }: {
    label: string;
    value: string;
    extensions: readonly string[];
    reset?: () => void;
    onchange: (v: string) => void;
  } = $props();

  const name = $derived(value.split(/[\\/]/).pop() ?? "");

  async function choose() {
    const picked = await pickFile({ title: label, filters: [{ name: label, extensions: [...extensions] }] });
    if ("path" in picked) onchange(picked.path);
    else if ("error" in picked) toasts.show(picked.error);
  }
</script>

<PrefRow {label} sub={name} {reset}>
  {#snippet control()}
    <button class="choose" type="button" onclick={choose}>Choose</button>
  {/snippet}
</PrefRow>

<style>
  .choose {
    padding: 4px 10px;
    font-size: 12.5px;
    color: var(--text);
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .choose:hover {
    background: var(--bg-hover);
  }
  .choose:focus-visible {
    outline: 2px solid var(--accent);
  }
</style>
