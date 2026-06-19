<script lang="ts">
  // In-place settings, navigated like a small wiki: a landing grid of category
  // cards, each opening a focused sub-page with a breadcrumb back to the grid.
  // Escape steps back to the grid first, then closes the whole view.
  import { onMount } from "svelte";
  import { openUrl } from "$lib/api/client";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { renderTemplate, TEMPLATE_VARS } from "$lib/contexting-format";
  import { library } from "$lib/stores/library.svelte";
  import type { Note, Tag } from "$lib/api/types";

  let {
    appVersion,
    onBack,
  }: {
    appVersion: string;
    onBack: () => void;
  } = $props();

  type Page = "home" | "about" | "contexting";
  let page = $state<Page>("home");

  const CATEGORIES: { id: Page; title: string; desc: string }[] = [
    { id: "about", title: "About", desc: "Version, platform, and project links." },
    { id: "contexting", title: "Contexting", desc: "Shape what copying a note hands to other tools and AI." },
  ];

  const TITLES: Record<Page, string> = { home: "Settings", about: "About", contexting: "Contexting" };

  // Live preview for the copy template, using the open note or a sample stand-in.
  const SAMPLE_NOTE: Pick<Note, "title" | "body" | "updatedAt"> = {
    title: "Sample note",
    body: "The quick brown fox.",
    updatedAt: new Date().toISOString(),
  };
  const SAMPLE_TAGS: Pick<Tag, "name">[] = [{ name: "example" }];

  const preview = $derived.by(() => {
    const note = library.selected;
    const tags = note ? library.selectedTags : SAMPLE_TAGS;
    return renderTemplate(contexting.copyTemplate, note ?? SAMPLE_NOTE, tags);
  });

  onMount(() => {
    void contexting.init();
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
              <span class="detail-val">{appVersion || "-"}</span>
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
      {:else if page === "contexting"}
        <div class="contexting-pane">
          <h2>Contexting</h2>
          <p class="section-hint">
            The template behind "Copy note as context" in the ⌘K palette. Wrap the note
            however a tool or model expects; this is the seed for InstantNotes' AI features.
          </p>

          <label class="field-label" for="ctx-template">Template</label>
          <textarea
            id="ctx-template"
            class="ctx-textarea"
            spellcheck="false"
            value={contexting.copyTemplate}
            oninput={(e) => contexting.setTemplate(e.currentTarget.value)}
          ></textarea>

          <div class="ctx-vars">
            {#each TEMPLATE_VARS as v}
              <code class="ctx-var">{v}</code>
            {/each}
          </div>

          <span class="field-label">Preview</span>
          <pre class="ctx-preview">{preview}</pre>
        </div>
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

  /* about */
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

  /* contexting */
  .contexting-pane {
    max-width: 560px;
  }
  .contexting-pane h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 4px;
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .field-label {
    display: block;
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .ctx-textarea {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  .ctx-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ctx-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .ctx-var {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-active);
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .ctx-preview {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
