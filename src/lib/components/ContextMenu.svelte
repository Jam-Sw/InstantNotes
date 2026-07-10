<script lang="ts">
  // Minimal right-click menu. The caller owns the state: render inside an
  // {#if} with a position and items, drop it on close. Focus moves to the
  // first item on open and returns to the invoker when the menu goes away.
  interface MenuItem {
    label: string;
    danger?: boolean;
    run: () => void;
  }

  let {
    x,
    y,
    items,
    onclose,
  }: { x: number; y: number; items: MenuItem[]; onclose: () => void } = $props();

  let menuEl = $state<HTMLDivElement>();
  let left = $state(-9999);
  let top = $state(-9999);

  // Clamp into the viewport once the menu has real dimensions. Reruns if the
  // caller repositions an already-open menu (right-click on another row).
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
    if (e.target instanceof Node && menuEl?.contains(e.target)) return;
    onclose();
  }

  function onKeydown(e: KeyboardEvent) {
    // Same keyboard boundary as the confirm dialog: nothing may fall through
    // to the global shortcuts while the menu is open.
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
        // Close first so focus restores to the invoker, then run: an action
        // that opens the confirm dialog captures the row, not a dead button.
        onclose();
        queueMicrotask(item.run);
      }}
    >
      {item.label}
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
  .item.danger {
    color: var(--danger);
  }
</style>
