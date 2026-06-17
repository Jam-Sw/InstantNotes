<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "$lib/api/client";

  let {
    appVersion,
    onBack,
  }: {
    appVersion: string;
    onBack: () => void;
  } = $props();

  type Tab = "about" | "default-new-tab";
  let activeTab = $state<Tab>("about");

  onMount(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

<div class="settings-layout">
  <aside class="settings-sidebar">
    <button class="back-btn" onclick={onBack}>
      <span class="back-arrow">&#8592;</span> Back
    </button>
    <div class="settings-label">Settings</div>
    <nav class="settings-nav">
      <button
        class="nav-item"
        class:active={activeTab === "about"}
        onclick={() => (activeTab = "about")}
      >
        About
      </button>
      <button
        class="nav-item"
        class:active={activeTab === "default-new-tab"}
        onclick={() => (activeTab = "default-new-tab")}
      >
        Default New Tab
      </button>
    </nav>
  </aside>

  <main class="settings-content">
    {#if activeTab === "about"}
      <div class="about-pane">
        <img class="app-icon" src="/app-icon.png" alt="InstantNotes" />
        <h1 class="app-name">InstantNotes</h1>
        {#if appVersion}
          <span class="version-badge">v{appVersion}</span>
        {/if}
        <p class="tagline">Instant capture, organized knowledge.</p>

        <div class="about-details">
          <div class="detail-row">
            <span class="detail-key">Version</span>
            <span class="detail-val">{appVersion || "—"}</span>
          </div>
          <hr />
          <div class="detail-row">
            <span class="detail-key">Platform</span>
            <span class="detail-val">macOS &middot; Apple Silicon</span>
          </div>
          <hr />
          <div class="detail-row">
            <span class="detail-key">Source</span>
            <button
              class="detail-link"
              onclick={() => openUrl("https://github.com/Jam-Sw/InstantNotes")}
            >
              GitHub &#8599;
            </button>
          </div>
        </div>
      </div>

    {:else if activeTab === "default-new-tab"}
      <div class="newtab-pane">
        <h2>Default New Tab</h2>
        <p class="section-hint">
          Configure what happens when you create a new note.
        </p>
        <div class="placeholder-card">
          <p>Options for default content, templates, and focus behavior will appear here.</p>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .settings-layout {
    display: grid;
    grid-template-columns: 200px 1fr;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
  }

  /* ---- sidebar ---- */
  .settings-sidebar {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
    overflow-y: auto;
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
  .settings-label {
    margin: 12px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .nav-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-ui);
  }
  .nav-item:hover {
    background: var(--bg-hover);
  }
  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }

  /* ---- content ---- */
  .settings-content {
    padding: 40px;
    overflow-y: auto;
    min-height: 0;
  }

  /* about tab */
  .about-pane {
    max-width: 400px;
    margin: 0 auto;
    text-align: center;
  }
  .app-icon {
    width: 80px;
    height: 80px;
    border-radius: 18px;
    margin-bottom: 12px;
  }
  .app-name {
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    font-family: var(--font-ui);
  }
  .version-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 1px 7px;
    border: 1px solid #e8923a;
    border-radius: 99px;
    color: #e8923a;
    background: rgba(232, 146, 58, 0.08);
    font-size: 10px;
    font-weight: 300;
    font-style: italic;
    letter-spacing: 0.3px;
  }
  .tagline {
    margin-top: 8px;
    color: var(--text-secondary);
    font-size: 13px;
    font-style: italic;
  }
  .about-details {
    margin-top: 28px;
    text-align: left;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
  }
  .detail-key {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-meta);
  }
  .detail-val {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }
  .detail-link {
    font-size: 13px;
    color: var(--accent);
    cursor: pointer;
  }
  .detail-link:hover {
    text-decoration: underline;
  }
  .about-details hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0;
  }

  /* default new tab */
  .newtab-pane {
    max-width: 480px;
  }
  .newtab-pane h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 4px;
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .placeholder-card {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    color: var(--text-tertiary);
    font-size: 13px;
  }
</style>
