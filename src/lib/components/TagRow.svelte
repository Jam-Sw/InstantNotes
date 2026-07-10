<script lang="ts">
  // One tag in the sidebar: click filters, double-click renames in place,
  // right-click (or Shift+F10) opens the row's context menu. No resting
  // chrome: management lives behind the menu, so a row is just the tag.
  import { normalizeTagInput } from "$lib/tag-name";
  import type { TagWithCount } from "$lib/api/types";

  let {
    tag,
    active,
    editing,
    onSelect,
    onStartRename,
    onRename,
    onDoneRename,
    onMenu,
  }: {
    tag: TagWithCount;
    active: boolean;
    editing: boolean;
    onSelect: () => void;
    onStartRename: () => void;
    onRename: (name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
    onDoneRename: () => void;
    onMenu: (x: number, y: number) => void;
  } = $props();

  let editValue = $state("");
  let editError = $state<string | null>(null);
  let selectButton = $state<HTMLButtonElement>();
  let inputEl = $state<HTMLInputElement>();
  let wasEditing = false;

  const noteLabel = $derived(`${tag.usageCount} note${tag.usageCount === 1 ? "" : "s"}`);

  // Seed and focus the input when the parent puts this row into edit mode;
  // hand focus back to the row itself when editing ends.
  $effect(() => {
    if (editing && !wasEditing) {
      editValue = tag.name;
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
    const normalized = normalizeTagInput(editValue);
    if (!normalized) {
      editError = "Tag name can't be empty";
      editValue = tag.name;
      return;
    }
    if (normalized === tag.name) {
      onDoneRename();
      return;
    }
    const result = await onRename(normalized);
    if (!editing) return; // blurred away while the request was in flight
    if (result.ok) {
      onDoneRename();
    } else {
      editError = result.message;
      editValue = tag.name;
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
  <div class="tag-edit">
    <span class="tag-hash">#</span>
    <input
      class="tag-rename-input"
      class:invalid={!!editError}
      bind:value={editValue}
      bind:this={inputEl}
      aria-label={`Rename tag ${tag.name}`}
      onkeydown={onRenameKeydown}
      onblur={onDoneRename}
    />
  </div>
  {#if editError}
    <p class="tag-error" role="alert">{editError}</p>
  {/if}
{:else}
  <button
    class="nav-item tag-item"
    class:active
    bind:this={selectButton}
    title={`${noteLabel} · Double-click renames, right-click for options`}
    onclick={onSelect}
    ondblclick={onStartRename}
    oncontextmenu={onContextMenu}
    onkeydown={onRowKeydown}
  >
    <span class="tag-name">#{tag.name}</span>
    <span class="tag-count">{tag.usageCount}</span>
  </button>
{/if}

<style>
  /* Mirrors the sidebar's .nav-item so a tag row reads as one of the list. */
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
  .tag-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-count {
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }

  .tag-edit {
    display: flex;
    align-items: center;
    padding-left: 10px;
  }
  .tag-hash {
    color: var(--text-tertiary);
  }
  .tag-rename-input {
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
  .tag-rename-input.invalid {
    border-color: var(--danger);
    animation: tag-shake 240ms ease-in-out;
  }
  @keyframes tag-shake {
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
  .tag-error {
    margin: 2px 0 4px;
    padding: 0 10px;
    color: var(--danger);
    font-size: 11px;
  }
</style>
