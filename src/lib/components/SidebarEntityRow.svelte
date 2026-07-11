<script lang="ts">
  // One entity in the sidebar (a space or a tag): click selects, double-click
  // renames in place, right-click (or Shift+F10) opens the row's context menu.
  // No resting chrome; a row is just the entity. Shared by spaces and tags,
  // parameterized by the count field, an optional prefix (# for tags), and the
  // name normalizer each uses.
  let {
    name,
    count,
    prefix = "",
    normalize,
    noun,
    active,
    editing,
    onSelect,
    onStartRename,
    onRename,
    onDoneRename,
    onMenu,
  }: {
    name: string;
    count: number;
    prefix?: string;
    normalize: (raw: string) => string | null;
    noun: string;
    active: boolean;
    editing: boolean;
    onSelect: () => void;
    onStartRename: () => void;
    onRename: (
      name: string,
    ) => Promise<{ ok: true } | { ok: false; message: string }>;
    onDoneRename: () => void;
    onMenu: (x: number, y: number) => void;
  } = $props();

  let editValue = $state("");
  let editError = $state<string | null>(null);
  let selectButton = $state<HTMLButtonElement>();
  let inputEl = $state<HTMLInputElement>();
  let wasEditing = false;

  const countLabel = $derived(`${count} note${count === 1 ? "" : "s"}`);

  // Seed and focus the input when the parent puts this row into edit mode;
  // hand focus back to the row itself when editing ends.
  $effect(() => {
    if (editing && !wasEditing) {
      editValue = name;
      editError = null;
      queueMicrotask(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    } else if (!editing && wasEditing) {
      queueMicrotask(() => selectButton?.focus());
    }
    wasEditing = editing;
  });

  async function commitRename() {
    if (!editing) return;
    // The backend normalizes the name; mirror it here so "same name" is a
    // no-op instead of a round-trip.
    const normalized = normalize(editValue);
    if (!normalized) {
      editError = `${noun} name can't be empty`;
      editValue = name;
      return;
    }
    if (normalized === name) {
      onDoneRename();
      return;
    }
    const result = await onRename(normalized);
    if (!editing) return; // blurred away while the request was in flight
    if (result.ok) {
      onDoneRename();
    } else {
      editError = result.message;
      editValue = name;
    }
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDoneRename();
    }
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    onMenu(e.clientX, e.clientY);
  }

  // Shift+F10 is the keyboard's right-click.
  function onRowKeydown(e: KeyboardEvent) {
    if (e.shiftKey && e.key === "F10") {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onMenu(rect.left + 12, rect.bottom - 2);
    }
  }
</script>

{#if editing}
  <div class="entity-edit">
    {#if prefix}<span class="entity-prefix">{prefix}</span>{/if}
    <input
      class="entity-rename-input"
      class:invalid={!!editError}
      bind:value={editValue}
      bind:this={inputEl}
      aria-label={`Rename ${noun.toLowerCase()} ${name}`}
      onkeydown={onRenameKeydown}
      onblur={onDoneRename}
    />
  </div>
  {#if editError}
    <p class="entity-error" role="alert">{editError}</p>
  {/if}
{:else}
  <button
    class="nav-item entity-item"
    class:active
    bind:this={selectButton}
    title={`${countLabel} · Double-click renames, right-click for options`}
    onclick={onSelect}
    ondblclick={onStartRename}
    oncontextmenu={onContextMenu}
    onkeydown={onRowKeydown}
  >
    <span class="entity-name">{prefix}{name}</span>
    <span class="entity-count">{count}</span>
  </button>
{/if}

<style>
  /* Mirrors the sidebar's .nav-item so a row reads as one of the list. */
  .nav-item {
    display: flex;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    text-align: left;
    padding: 5px 10px;
    border-radius: var(--radius);
    color: var(--text);
  }
  .nav-item:hover {
    background: var(--bg-hover);
  }
  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .entity-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entity-count {
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }

  .entity-edit {
    display: flex;
    align-items: center;
    padding-left: 10px;
  }
  .entity-prefix {
    color: var(--text-tertiary);
  }
  .entity-rename-input {
    flex: 1;
    min-width: 0;
    margin: 2px 0;
    padding: 3px 6px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    outline: none;
    background: var(--bg-input);
    color: var(--text);
    font-size: inherit;
  }
  .entity-rename-input.invalid {
    border-color: var(--danger);
    animation: entity-shake 240ms ease-in-out;
  }
  @keyframes entity-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .entity-rename-input.invalid {
      animation: none;
    }
  }
  .entity-error {
    margin: 2px 0 4px;
    padding: 0 10px;
    color: var(--danger);
    font-size: 11px;
  }
</style>
