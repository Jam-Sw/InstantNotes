<script lang="ts">
  // In-place settings, navigated like a small wiki: a landing grid of category
  // cards, each opening a focused sub-page with a breadcrumb back to the grid.
  // Escape steps back to the grid first, then closes the whole view. Each
  // sub-page is its own component under settings/.
  import { onMount } from "svelte";
  import SettingsAbout from "$lib/components/settings/SettingsAbout.svelte";
  import SettingsContexting from "$lib/components/settings/SettingsContexting.svelte";
  import SettingsLinks from "$lib/components/settings/SettingsLinks.svelte";

  let {
    appVersion,
    onBack,
  }: {
    appVersion: string;
    onBack: () => void;
  } = $props();

  type Page = "home" | "about" | "contexting" | "links";
  let page = $state<Page>("home");

  const CATEGORIES: { id: Page; title: string; desc: string }[] = [
    { id: "about", title: "About", desc: "Version, platform, and project links." },
    { id: "links", title: "Links", desc: "How links in your notes look and open." },
    { id: "contexting", title: "Contexting", desc: "Shape what copying a note hands to other tools and AI." },
  ];

  const TITLES: Record<Page, string> = { home: "Settings", about: "About", contexting: "Contexting", links: "Links" };

  onMount(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (page !== "home") page = "home";
        else onBack();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

<div class="settings-root">
  <header class="settings-head">
    {#if page === "home"}
      <button class="back-btn" onclick={onBack}>
        <span class="back-arrow">&#8592;</span> Back
      </button>
      <h1 class="settings-title">Settings</h1>
    {:else}
      <button class="back-btn" onclick={() => (page = "home")}>
        <span class="back-arrow">&#8249;</span> Back
      </button>
      <nav class="crumb" aria-label="Breadcrumb">
        <button class="crumb-link" onclick={() => (page = "home")}>Settings</button>
        <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
        <span class="crumb-current">{TITLES[page]}</span>
      </nav>
    {/if}
  </header>

  {#if page === "home"}
    <div class="settings-grid">
      {#each CATEGORIES as cat (cat.id)}
        <button class="settings-card" onclick={() => (page = cat.id)}>
          <span class="card-title">{cat.title}</span>
          <span class="card-desc">{cat.desc}</span>
        </button>
      {/each}
    </div>
  {:else}
    <main class="settings-content">
      {#if page === "about"}
        <SettingsAbout {appVersion} />
      {:else if page === "contexting"}
        <SettingsContexting />
      {:else if page === "links"}
        <SettingsLinks />
      {/if}
    </main>
  {/if}
</div>

<style>
  .settings-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
  }

  /* ---- header / breadcrumb ---- */
  .settings-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
    font-family: var(--font-ui);
  }
  .back-btn:hover {
    background: var(--bg-hover);
  }
  .back-arrow {
    font-size: 14px;
  }
  .settings-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin: 0;
    font-family: var(--font-ui);
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-family: var(--font-ui);
  }
  .crumb-link {
    color: var(--accent);
  }
  .crumb-link:hover {
    text-decoration: underline;
  }
  .crumb-sep {
    color: var(--text-tertiary);
  }
  .crumb-current {
    color: var(--text);
    font-weight: 500;
  }

  /* ---- landing grid ---- */
  .settings-grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    align-content: start;
  }
  .settings-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
  }
  .settings-card:hover {
    background: var(--bg-hover);
  }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-ui);
  }
  .card-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  /* ---- sub-page content ---- */
  .settings-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 32px 40px;
  }
</style>
