<script lang="ts">
  // ⌘K command palette: a centered overlay with a fuzzy-filtered command list.
  // Commands are rebuilt each time it opens (theme list and selection-aware
  // labels stay current). Keyboard: ↑/↓ move, ↵ runs, Esc closes.
  import {
    buildCommands,
    buildThemeCommands,
    filterCommands,
    recentCommands,
    recordRecent,
    type Command,
  } from "$lib/commands";
  import { theme } from "$lib/stores/theme.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let query = $state("");
  let active = $state(0);
  let view = $state<"root" | "theme">("root");
  let commands = $state<Command[]>([]);
  let themeCommands = $state<Command[]>([]);
  let input = $state<HTMLInputElement>();

  // Empty query shows recents first (if any), then everything; otherwise the
  // ranked fuzzy results.
  const results = $derived.by(() => {
    if (view === "theme") {
      return query.trim() ? filterCommands(themeCommands, query) : themeCommands;
    }
    if (query.trim()) return filterCommands(commands, query);
    const recents = recentCommands(commands);
    const seen = new Set(recents.map((c) => c.id));
    return [...recents, ...commands.filter((c) => !seen.has(c.id))];
  });

  // Reset and focus whenever the palette opens.
  $effect(() => {
    if (open) {
      commands = buildCommands();
      themeCommands = buildThemeCommands();
      query = "";
      active = 0;
      view = "root";
      queueMicrotask(() => input?.focus());
    }
  });

  // Keep the active index in range as results shrink.
  $effect(() => {
    if (active >= results.length) active = Math.max(0, results.length - 1);
  });

  function run(cmd: Command) {
    if (cmd.id === "theme.switch") {
      view = "theme";
      query = "";
      active = 0;
      return;
    }
    if (view === "theme") recordRecent("theme.switch");
    open = false;
    recordRecent(cmd.id);
    void cmd.run();
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
        if (view !== "root") {
          view = "root";
          query = "";
          active = 0;
        } else {
          open = false;
        }
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
      {#if view === "theme"}
        <button class="back-btn" onclick={() => { view = "root"; query = ""; active = 0; }}>
          ← Themes
        </button>
      {/if}
      <input
        bind:this={input}
        bind:value={query}
        class="cmd-input"
        type="text"
        placeholder={view === "theme" ? "Search themes…" : "Type a command…"}
        aria-label="Command"
        onkeydown={onKeydown}
      />
      <div class="cmd-list">
        {#each results as cmd, i (cmd.id)}
          <button
            class="cmd-row"
            class:active={i === active}
            data-index={i}
            onclick={() => run(cmd)}
            onmousemove={() => (active = i)}
          >
            <span class="cmd-title">{cmd.title}</span>
            <span class="cmd-meta">
              {#if view === "theme" && cmd.id === `theme.set.${theme.activeId}`}
                <span class="theme-check">&#10003;</span>
              {/if}
              {#if cmd.shortcut}<kbd>{cmd.shortcut}</kbd>{/if}
              <span class="cmd-group">{cmd.group}</span>
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
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
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
  .cmd-title {
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
