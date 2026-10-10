<script lang="ts">
  interface MenuItem {
    label: string;
    hint?: string;
    danger?: boolean;
    run: () => void;
  }

  let {
    x,
    y,
    items,
    anchor,
    onclose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    anchor?: HTMLElement;
    onclose: () => void;
  } = $props();

  let menuEl = $state<HTMLDivElement>();
  let left = $state(-9999);
  let top = $state(-9999);

  $effect(() => {
    const rect = menuEl?.getBoundingClientRect();
    const pad = 8;
    left = Math.max(pad, Math.min(x, window.innerWidth - (rect?.width ?? 160) - pad));
    top = Math.max(pad, Math.min(y, window.innerHeight - (rect?.height ?? 80) - pad));
  });

  $effect(() => {
    const invoker =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuEl?.querySelector("button")?.focus();
    return () => invoker?.focus();
  });

  function onWindowEvent(e: Event) {
    if (!(e.target instanceof Node)) return onclose();
    if (menuEl?.contains(e.target) || anchor?.contains(e.target)) return;
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    const buttons = [...(menuEl?.querySelectorAll("button") ?? [])];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onclose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  }
</script>

<svelte:window
  onpointerdowncapture={onWindowEvent}
  oncontextmenucapture={onWindowEvent}
  onblur={onclose}
  onresize={onclose}
/>

<div
  class="menu"
  role="menu"
  tabindex="-1"
  bind:this={menuEl}
  style:left={`${left}px`}
  style:top={`${top}px`}
  onkeydown={onKeydown}
>
  {#each items as item (item.label)}
    <button
      class="item"
      class:danger={item.danger}
      role="menuitem"
      onclick={() => {
        onclose();
        queueMicrotask(item.run);
      }}
    >
      <span class="label">{item.label}</span>
      {#if item.hint}<span class="hint">{item.hint}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 120;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  .item {
    display: flex;
    align-items: baseline;
    gap: 18px;
    text-align: left;
    padding: 5px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text);
  }
  .item:hover,
  .item:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  .label {
    flex: 1;
  }
  .hint {
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .item.danger {
    color: var(--danger);
  }
</style>
