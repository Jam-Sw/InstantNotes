<script lang="ts">
  import { SWATCH_NAMES, SWATCH_VAR } from "$lib/themes/types";
  import { cssColor, normalizeHex } from "$lib/space-colors";

  let {
    value,
    label = "Color",
    onpick,
  }: {
    value: string | null;
    label?: string;
    onpick: (color: string | null) => void;
  } = $props();

  let group = $state<HTMLDivElement>();
  let customOpen = $state(false);
  let customText = $state("");
  let customInput = $state<HTMLInputElement>();

  const isCustom = $derived(!!value && value.startsWith("#"));
  const parsed = $derived(normalizeHex(customText));
  const invalid = $derived(customText.trim() !== "" && parsed === null);
  const current = $derived(
    value === null ? "none" : isCustom ? "custom" : SWATCH_NAMES.includes(value as never) ? value : "none",
  );

  function pick(color: string | null) {
    onpick(color);
  }

  function openCustom() {
    customOpen = true;
    customText = isCustom ? (value as string) : "";
    queueMicrotask(() => {
      customInput?.focus();
      customInput?.select();
    });
  }

  function applyCustom() {
    if (parsed) pick(parsed);
  }

  function onCustomKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      applyCustom();
    }
  }

  function onGroupKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const buttons = [...(group?.querySelectorAll<HTMLButtonElement>("button[data-stop]") ?? [])];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % buttons.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[next].focus();
  }
</script>

<div class="picker" bind:this={group} role="radiogroup" aria-label={label} tabindex="-1" onkeydown={onGroupKeydown}>
  <div class="dots">
    {#each SWATCH_NAMES as name (name)}
      <button
        class="dot"
        type="button"
        role="radio"
        data-stop
        aria-checked={current === name}
        aria-label={name}
        title={name}
        tabindex={current === name || (current === "none" && name === SWATCH_NAMES[0]) ? 0 : -1}
        style:background={`var(${SWATCH_VAR[name]})`}
        onclick={() => pick(name)}
      ></button>
    {/each}
  </div>
  <div class="actions">
    <button
      class="act"
      type="button"
      role="radio"
      data-stop
      aria-checked={current === "none"}
      tabindex={-1}
      onclick={() => pick(null)}
    >
      <span class="mark none" aria-hidden="true"></span>None
    </button>
    <button
      class="act"
      type="button"
      role="radio"
      data-stop
      aria-checked={current === "custom"}
      tabindex={current === "custom" ? 0 : -1}
      onclick={openCustom}
    >
      <span class="mark" style:background={isCustom ? cssColor(value) : "var(--bg)"} aria-hidden="true"></span>Custom...
    </button>
  </div>
  {#if customOpen}
    <div class="custom-row">
      <span class="mark" style:background={parsed ?? "var(--bg)"} aria-hidden="true"></span>
      <input
        class="hex"
        class:invalid
        bind:this={customInput}
        bind:value={customText}
        placeholder="#3a7bff"
        spellcheck="false"
        autocomplete="off"
        maxlength="7"
        aria-label="Custom color, as #rrggbb"
        aria-invalid={invalid}
        onkeydown={onCustomKeydown}
      />
      <button class="apply" type="button" disabled={!parsed} onclick={applyCustom}>Set</button>
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    outline: none;
  }
  .dots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .dot {
    position: relative;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    flex-shrink: 0;
  }
  .dot:hover {
    transform: scale(1.12);
  }
  .dot[aria-checked="true"] {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 3.5px var(--text);
  }
  .dot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 4px;
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--text-secondary);
  }
  .act:hover,
  .act:focus-visible {
    background: var(--bg-hover);
    color: var(--text);
    outline: none;
  }
  .act[aria-checked="true"] {
    color: var(--text);
    font-weight: 600;
  }
  .mark {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--text) 25%, transparent);
    flex-shrink: 0;
  }
  .mark.none {
    background:
      linear-gradient(
        to top right,
        transparent calc(50% - 0.75px),
        var(--text-tertiary) calc(50% - 0.75px),
        var(--text-tertiary) calc(50% + 0.75px),
        transparent calc(50% + 0.75px)
      ),
      var(--bg);
  }
  .custom-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hex {
    width: 84px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .hex:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hex.invalid {
    border-color: var(--danger);
  }
  .apply {
    padding: 3px 9px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 500;
  }
  .apply:disabled {
    opacity: 0.45;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot:hover {
      transform: none;
    }
  }
</style>
