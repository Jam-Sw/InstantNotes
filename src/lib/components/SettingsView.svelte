<script lang="ts">
  // In-place settings, navigated like a small wiki. The landing page is a
  // dashboard (the "under the hood" view): live library stats, what's new in
  // the installed version, and a card per settings category. Each sub-page is
  // its own component under settings/. Escape steps back to the dashboard
  // first, then closes the whole view.
  import { onMount } from "svelte";
  import SettingsAbout from "$lib/components/settings/SettingsAbout.svelte";
  import SettingsEditor from "$lib/components/settings/SettingsEditor.svelte";
  import SettingsImages from "$lib/components/settings/SettingsImages.svelte";
  import SettingsContexting from "$lib/components/settings/SettingsContexting.svelte";
  import SettingsLinks from "$lib/components/settings/SettingsLinks.svelte";
  import SettingsFeedback from "$lib/components/settings/SettingsFeedback.svelte";
  import { getLibraryStats, getCaptureLatency, openUrl } from "$lib/api/client";
  import type { DashboardStats } from "$lib/api/types";
  import { formatBytes } from "$lib/format";
  import { parseChangelog } from "$lib/changelog";
  import changelogRaw from "../../../CHANGELOG.md?raw";

  let {
    appVersion,
    onBack,
  }: {
    appVersion: string;
    onBack: () => void;
  } = $props();

  type Page = "home" | "about" | "editor" | "images" | "links" | "contexting" | "feedback";
  let page = $state<Page>("home");

  const CATEGORIES: { id: Page; title: string; desc: string }[] = [
    { id: "about", title: "About", desc: "Version, platform, and project links." },
    { id: "editor", title: "Editor", desc: "Timestamps and writing preferences." },
    { id: "images", title: "Images", desc: "How images are stored, shown, and shared." },
    { id: "links", title: "Links", desc: "How links in your notes look and open." },
    { id: "contexting", title: "Contexting", desc: "Shape what copying a note hands to other tools and AI." },
    { id: "feedback", title: "Feedback", desc: "Report a bug or send an idea." },
  ];

  const TITLES: Record<Page, string> = {
    home: "Settings",
    about: "About",
    editor: "Editor",
    images: "Images",
    contexting: "Contexting",
    links: "Links",
    feedback: "Feedback",
  };

  let stats = $state<DashboardStats | null>(null);
  let captureMs = $state<number | null>(null);
  // The installed version's changelog section, parsed from the bundled file.
  const release = $derived(parseChangelog(changelogRaw, appVersion));

  onMount(() => {
    void getLibraryStats()
      .then((s) => (stats = s))
      .catch(() => {});
    void getCaptureLatency()
      .then((s) => (captureMs = s.medianMs))
      .catch(() => {});

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
    <div class="settings-home">
      <section class="stat-grid" aria-label="Library stats">
        <div class="stat">
          <span class="stat-num">{stats?.notesTotal ?? "-"}</span>
          <span class="stat-label">Notes</span>
          <span class="stat-sub"
            >{stats ? `${stats.notesPinned} pinned · ${stats.notesArchived} archived` : ""}</span
          >
        </div>
        <div class="stat">
          <span class="stat-num">{stats?.tags ?? "-"}</span>
          <span class="stat-label">Tags</span>
          <span class="stat-sub"></span>
        </div>
        <div class="stat">
          <span class="stat-num">{stats?.spaces ?? "-"}</span>
          <span class="stat-label">Spaces</span>
          <span class="stat-sub"></span>
        </div>
        <div class="stat">
          <span class="stat-num">{stats?.attachmentsCount ?? "-"}</span>
          <span class="stat-label">Attachments</span>
          <span class="stat-sub">{stats ? formatBytes(stats.attachmentsBytes) : ""}</span>
        </div>
        <div class="stat">
          <span class="stat-num">{captureMs !== null ? `${captureMs}` : "-"}<span class="stat-unit">ms</span></span>
          <span class="stat-label">Capture</span>
          <span class="stat-sub">reveal to ready</span>
        </div>
        <div class="stat">
          <span class="stat-num">{stats?.notesTrashed ?? "-"}</span>
          <span class="stat-label">In Trash</span>
          <span class="stat-sub"></span>
        </div>
      </section>

      {#if release && release.sections.length > 0}
        <section class="whatsnew">
          <header class="wn-head">
            <h2 class="wn-title">What's new in v{release.version}</h2>
            {#if release.date}<span class="wn-date">{release.date}</span>{/if}
          </header>
          {#each release.sections as sec (sec.heading)}
            <div class="wn-section">
              {#if sec.heading}<span class="wn-kind">{sec.heading}</span>{/if}
              <ul class="wn-list">
                {#each sec.items as item, i (i)}
                  <li>{item}</li>
                {/each}
              </ul>
            </div>
          {/each}
          <button
            class="wn-link"
            onclick={() => openUrl("https://github.com/Jam-Sw/InstantNotes/blob/main/CHANGELOG.md")}
          >Full changelog &#8599;</button>
        </section>
      {/if}

      <section class="settings-grid">
        {#each CATEGORIES as cat (cat.id)}
          <button class="settings-card" onclick={() => (page = cat.id)}>
            <span class="card-title">{cat.title}</span>
            <span class="card-desc">{cat.desc}</span>
          </button>
        {/each}
      </section>
    </div>
  {:else}
    <main class="settings-content">
      {#if page === "about"}
        <SettingsAbout {appVersion} />
      {:else if page === "editor"}
        <SettingsEditor />
      {:else if page === "images"}
        <SettingsImages />
      {:else if page === "contexting"}
        <SettingsContexting />
      {:else if page === "links"}
        <SettingsLinks />
      {:else if page === "feedback"}
        <SettingsFeedback {appVersion} />
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

  /* ---- dashboard ---- */
  .settings-home {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
  }
  .stat-num {
    font-size: 24px;
    font-weight: 700;
    color: var(--text);
    font-family: var(--font-ui);
    line-height: 1.1;
  }
  .stat-unit {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
    margin-left: 2px;
  }
  .stat-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-meta);
  }
  .stat-sub {
    font-size: 11px;
    color: var(--text-tertiary);
    min-height: 13px;
  }

  /* ---- what's new ---- */
  .whatsnew {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    background: var(--bg-sidebar);
  }
  .wn-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .wn-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    font-family: var(--font-ui);
  }
  .wn-date {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .wn-section {
    margin-bottom: 10px;
  }
  .wn-kind {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent-text);
    background: var(--accent-soft);
    border-radius: 99px;
    padding: 1px 8px;
    margin-bottom: 6px;
  }
  .wn-list {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .wn-list li {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .wn-link {
    margin-top: 6px;
    color: var(--accent);
    font-size: 12px;
  }
  .wn-link:hover {
    text-decoration: underline;
  }

  /* ---- category nav ---- */
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
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
