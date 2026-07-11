<script lang="ts">
  // One space in the sidebar: click switches, double-click renames in place,
  // right-click (or Shift+F10) opens the row's context menu. Same contract
  // as TagRow, and the same rule: no resting chrome, a row is just the space.
  import type { WorkspaceWithCount } from "$lib/api/types";

  let {
    workspace,
    active,
    editing,
    onSelect,
    onStartRename,
    onRename,
    onDoneRename,
    onMenu,
  }: {
    workspace: WorkspaceWithCount;
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

  const noteLabel = $derived(
    `${workspace.noteCount} note${workspace.noteCount === 1 ? "" : "s"}`,
  );

  // Seed and focus the input when the parent puts this row into edit mode;
  // hand focus back to the row itself when editing ends.
  $effect(() => {
    if (editing && !wasEditing) {
      editValue = workspace.name;
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
    // The backend normalizes to a trimmed name; mirror it here so "same
    // name with spaces" is a no-op instead of a round-trip.
    const normalized = editValue.trim();
    if (!normalized) {
      editError = "Space name can't be empty";
      editValue = workspace.name;
      return;
    }
    if (normalized === workspace.name) {
      onDoneRename();
      return;
    }
    const result = await onRename(normalized);
    if (!editing) return; // blurred away while the request was in flight
    if (result.ok) {
      onDoneRename();
    } else {
      editError = result.message;
      editValue = workspace.name;
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
  <div class="space-edit">
    <input
      class="space-rename-input"
      class:invalid={!!editError}
      bind:value={editValue}
      bind:this={inputEl}
      aria-label={`Rename space ${workspace.name}`}
      onkeydown={onRenameKeydown}
      onblur={onDoneRename}
    />
  </div>
  {#if editError}
    <p class="space-error" role="alert">{editError}</p>
  {/if}
{:else}
  <button
    class="nav-item space-item"
    class:active
    bind:this={selectButton}
    title={`${noteLabel} · Double-click renames, right-click for options`}
    onclick={onSelect}
    ondblclick={onStartRename}
    oncontextmenu={onContextMenu}
    onkeydown={onRowKeydown}
  >
    <span class="space-name">{workspace.name}</span>
    <span class="space-count">{workspace.noteCount}</span>
  </button>
{/if}

<style>
  /* Mirrors the sidebar's .nav-item so a space row reads as one of the list. */
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
  .space-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .space-count {
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }

  .space-edit {
    display: flex;
    align-items: center;
    padding-left: 10px;
  }
  .space-rename-input {
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
  .space-rename-input.invalid {
    border-color: var(--danger);
    animation: space-shake 240ms ease-in-out;
  }
  @keyframes space-shake {
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
    .space-rename-input.invalid {
      animation: none;
    }
  }
  .space-error {
    margin: 2px 0 4px;
    padding: 0 10px;
    color: var(--danger);
    font-size: 11px;
  }
</style>
