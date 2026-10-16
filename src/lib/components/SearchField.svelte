<script lang="ts">
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { clientLabel } from "$lib/agent-activity";

  // The note search, wherever it shows: the list header, or the welcome screen
  // while the list is hidden. Both edit the one query in library.searchText.
  let { onkeydown }: { onkeydown?: (e: KeyboardEvent) => void } = $props();

  const agentSearch = $derived(library.searchText ? null : agents.currentSearch);
</script>

<div class="search-wrap" data-agent={agentSearch ? "search" : null}>
  <input
    class="search"
    type="search"
    placeholder={agentSearch
      ? `${clientLabel(agentSearch.client)} searched “${agentSearch.query}”`
      : "Search notes…"}
    value={library.searchText}
    oninput={(e) => library.setSearch(e.currentTarget.value)}
    {onkeydown}
  />
  {#if agentSearch}
    {@const search = agentSearch}
    <button
      class="agent-search-run"
      title="Run this search yourself"
      onclick={() => library.setSearch(search.query ?? "")}
    >
      {search.noteCount} hit{search.noteCount === 1 ? "" : "s"}
    </button>
  {/if}
</div>

<style>
  .search-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    position: relative;
  }
  .search {
    flex: 1;
    min-width: 0;
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    outline: none;
  }
  .search:focus {
    border-color: var(--accent);
  }
  .search-wrap[data-agent] .search {
    padding-right: 68px;
  }
  .agent-search-run {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    padding: 1px 8px;
    border-radius: 99px;
    background: var(--select-bg);
    color: var(--accent-text);
    font-family: var(--font-meta);
    font-size: 11px;
  }
</style>
