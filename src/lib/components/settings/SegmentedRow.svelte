<script lang="ts" generics="T extends string">
  // A labeled segmented choice: the shared multi-option control used across
  // settings pages, matching the segmented control on the Links page.
  //
  // It is a real radio group, not a row of buttons: the selected segment is the
  // group's single tab stop and the arrow keys move the selection, which is
  // what the role promises and what a native segmented control does.
  import PrefRow from "./PrefRow.svelte";
  type Option = { value: T; label: string };
  let {
    label,
    sub = "",
    options,
    value,
    disabled = false,
    onchange,
  }: {
    label: string;
    sub?: string;
    options: Option[];
    value: T;
    disabled?: boolean;
    onchange: (v: T) => void;
  } = $props();

  const subId = $props.id();
  let group = $state<HTMLDivElement>();

  const selected = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

  // Keyboard selection moves focus with it, because the segment that is
  // selected is the one that is tabbable; leaving focus behind would strand it
  // on an element that is no longer in the tab order.
  // The guard is not redundant with the disabled attribute: that stops a real
  // click, this keeps "onchange never fires while disabled" true of the
  // component itself, whoever dispatches the event.
  function selectAt(i: number) {
    const o = options[i];
    if (disabled || !o) return;
    group?.querySelectorAll("button")[i]?.focus();
    if (o.value !== value) onchange(o.value);
  }

  function onkeydown(e: KeyboardEvent) {
    if (disabled) return;
    const last = options.length - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") selectAt(selected === last ? 0 : selected + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") selectAt(selected === 0 ? last : selected - 1);
    else if (e.key === "Home") selectAt(0);
    else if (e.key === "End") selectAt(last);
    else return;
    e.preventDefault();
  }
</script>

<PrefRow {label} {sub} {subId} {disabled}>
  {#snippet control()}
    <div
      class="seg"
      role="radiogroup"
      aria-label={label}
      aria-describedby={sub ? subId : undefined}
      bind:this={group}
    >
      {#each options as o, i (o.value)}
        <!-- The keys live on the segments, not the group: the selected segment
             is what holds focus, so it is what receives the key. -->
        <button
          class="seg-btn"
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabindex={i === selected ? 0 : -1}
          {disabled}
          onclick={() => selectAt(i)}
          {onkeydown}
        >{o.label}</button>
      {/each}
    </div>
  {/snippet}
</PrefRow>

<style>
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
  .seg-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .seg-btn[aria-checked="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  /* The selected segment already carries an accent background, so focus needs
     a ring of its own to stay legible. */
  .seg-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .seg-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
