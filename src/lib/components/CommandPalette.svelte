<script lang="ts">
  // ⌘K command palette: a centered overlay with a fuzzy-filtered command list.
  // Commands are rebuilt each time it opens (theme list and selection-aware
  // labels stay current). Keyboard: ↑/↓ move, ↵ runs, Esc closes.
  import {
    buildCommands,
    filterCommands,
    recentCommands,
    recordRecent,
    childrenOf,
    findCommand,
    resolveActivation,
    type Command,
  } from "$lib/commands";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let query = $state("");
  let active = $state(0);
  // Which folder we are inside; null is the top level. Back-navigation and
  // breadcrumbs are derived from the commands' own parent pointers, so no
  // per-view enum or navigation stack is needed.
  let currentParent = $state<string | null>(null);
  let commands = $state<Command[]>([]);
  let input = $state<HTMLInputElement>();

  // The folder command we are inside, if any (for the back button + placeholder).
  const folder = $derived(findCommand(commands, currentParent));

  // Empty query shows the current level (recents first at the top level);
  // otherwise the ranked fuzzy results over the current search scope.
  const results = $derived.by(() => {
    if (query.trim()) {
      // Search the whole tree at the top level, the open folder's children when
      // inside one. Leaves matched outside their folder show a breadcrumb.
      const scope = currentParent === null ? commands : childrenOf(commands, currentParent);
      return filterCommands(scope, query);
    }
    const level = childrenOf(commands, currentParent);
    if (currentParent !== null) return level;
    const recents = recentCommands(commands);
    const seen = new Set(recents.map((c) => c.id));
    return [...recents, ...level.filter((c) => !seen.has(c.id))];
  });

  // Reset and focus whenever the palette opens.
  $effect(() => {
    if (open) {
      commands = buildCommands();
      query = "";
      active = 0;
      currentParent = null;
      queueMicrotask(() => input?.focus());
    }
  });

  // Keep the active index in range as results shrink.
  $effect(() => {
    if (active >= results.length) active = Math.max(0, results.length - 1);
  });

  function descend(id: string) {
    currentParent = id;
    query = "";
    active = 0;
  }

  function goUp() {
    currentParent = findCommand(commands, currentParent)?.parent ?? null;
    query = "";
    active = 0;
  }

  function run(cmd: Command) {
    const action = resolveActivation(commands, cmd);
    if (action.kind === "descend") {
      descend(action.parent);
      return;
    }
    // keepOpen is a property of the command (value pickers like themes set it),
    // so applying one stays open whether reached from its folder or a search.
    recordRecent(cmd.id);
    void cmd.run();
    if (!action.keepOpen) open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        active = Math.min(active + 1, results.length - 1);
        scrollActiveIntoView();
        break;
      case "ArrowUp":
        e.preventDefault();
        active = Math.max(active - 1, 0);
        scrollActiveIntoView();
        break;
      case "Enter":
        e.preventDefault();
        if (results[active]) run(results[active]);
        break;
      case "Escape":
        e.preventDefault();
        if (currentParent !== null) goUp();
        else open = false;
        break;
    }
  }

  function scrollActiveIntoView() {
    queueMicrotask(() => {
      document
        .querySelector(`.cmd-row[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
</script>

{#if open}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) open = false;
    }}
    onkeydown={onKeydown}
  >
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
      {#if folder}
        <button class="back-btn" onclick={goUp}>
          ← {folder.title}
        </button>
      {/if}
      <input
        bind:this={input}
        bind:value={query}
        class="cmd-input"
        type="text"
        placeholder={folder ? `Search ${folder.title.toLowerCase()}…` : "Type a command…"}
        aria-label="Command"
      />
      <div class="cmd-list">
        {#each results as cmd, i (cmd.id)}
          <button
            class="cmd-row"
            class:active={i === active}
            class:emphasis={cmd.emphasis}
            data-index={i}
            onclick={() => run(cmd)}
            onmousemove={() => (active = i)}
          >
            <span class="cmd-title">
              {#if cmd.icon}<span class="cmd-icon" aria-hidden="true">{cmd.icon()}</span>{/if}{#if cmd.prefix}<span class="cmd-parent">{cmd.prefix}</span><span class="cmd-crumb" aria-hidden="true">&rsaquo;</span>{/if}{#if cmd.parent && cmd.parent !== currentParent}<span class="cmd-parent">{findCommand(commands, cmd.parent)?.title}</span><span class="cmd-crumb" aria-hidden="true">&rsaquo;</span>{/if}<span class="cmd-action">{cmd.title}</span>
            </span>
            <span class="cmd-meta">
              {#if cmd.isActive?.()}
                <span class="theme-check">&#10003;</span>
              {/if}
              {#if cmd.shortcut}<kbd>{cmd.shortcut}</kbd>{/if}
              {#if !(cmd.parent && cmd.parent !== currentParent)}<span class="cmd-group">{cmd.group}</span>{/if}
            </span>
          </button>
        {:else}
          <div class="cmd-empty">No matching commands</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.32);
  }
  .palette {
    width: min(560px, 90vw);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    font-size: 12px;
    color: var(--text-tertiary);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
  }
  .back-btn:hover {
    color: var(--text-secondary);
  }
  .theme-check {
    color: var(--accent-text);
    font-size: 13px;
  }
  .cmd-input {
    border: none;
    outline: none;
    background: transparent;
    padding: 14px 16px;
    font-size: 15px;
    color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .cmd-input::placeholder {
    color: var(--text-tertiary);
  }
  .cmd-list {
    overflow-y: auto;
    padding: 6px;
  }
  .cmd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--radius);
    color: var(--text);
  }
  .cmd-row.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  /* The light/dark toggle is an action, not a theme: give it an accent border,
     bolder label, and a little breathing room below to part it from the list. */
  .cmd-row.emphasis {
    border: 1px solid var(--accent);
    margin-bottom: 6px;
    font-weight: 600;
  }
  .cmd-row.emphasis.active {
    border-color: transparent;
  }
  .cmd-icon {
    margin-right: 8px;
    color: var(--accent-text);
    flex-shrink: 0;
  }
  /* A flex row so the action label keeps its width while a long note-title
     prefix takes its own ellipsis instead of clipping the whole line. */
  .cmd-title {
    display: flex;
    align-items: baseline;
    min-width: 0;
    overflow: hidden;
  }
  .cmd-parent {
    color: var(--text-tertiary);
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }
  .cmd-crumb {
    margin: 0 6px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .cmd-action {
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cmd-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    font-family: var(--font-meta);
  }
  .cmd-group {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .cmd-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
  }
  kbd {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
