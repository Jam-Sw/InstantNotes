<script lang="ts">
  import { onMount } from "svelte";
  import SettingsAbout from "$lib/components/settings/SettingsAbout.svelte";
  import SettingsAppearance from "$lib/components/settings/SettingsAppearance.svelte";
  import SettingsEditor from "$lib/components/settings/SettingsEditor.svelte";
  import SettingsImages from "$lib/components/settings/SettingsImages.svelte";
  import SettingsContexting from "$lib/components/settings/SettingsContexting.svelte";
  import SettingsLinks from "$lib/components/settings/SettingsLinks.svelte";
  import SettingsFeedback from "$lib/components/settings/SettingsFeedback.svelte";
  import SettingsVault from "$lib/components/settings/SettingsVault.svelte";
  import SettingsAgents from "$lib/components/settings/SettingsAgents.svelte";
  import SettingsImport from "$lib/components/settings/SettingsImport.svelte";
  import { getLibraryStats, getCaptureLatency, openUrl } from "$lib/api/client";
  import type { DashboardStats } from "$lib/api/types";
  import { formatBytes } from "$lib/format";
  import { isMac } from "$lib/platform";
  import { parseChangelog } from "$lib/changelog";
  import { theme } from "$lib/stores/theme.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import changelogRaw from "../../../CHANGELOG.md?raw";

  let {
    appVersion,
    onBack,
    onShowSpace,
    initialPage = "home",
  }: {
    appVersion: string;
    onBack: () => void;
    onShowSpace: (workspaceId: string) => void;
    initialPage?: Page;
  } = $props();

  type Page =
    | "home"
    | "appearance"
    | "about"
    | "editor"
    | "images"
    | "links"
    | "contexting"
    | "feedback"
    | "vault"
    | "agents"
    | "import";
  // svelte-ignore state_referenced_locally
  let page = $state<Page>(initialPage);
  let filter = $state("");
  let filterInput = $state<HTMLInputElement>();

  interface Entry {
    id: Page;
    title: string;
    desc: string;
    keywords: string;
  }
  interface Group {
    label: string;
    entries: Entry[];
  }

  const GROUPS: Group[] = [
    {
      label: "General",
      entries: [
        { id: "home", title: "Overview", desc: "Your library at a glance and what's new.", keywords: "dashboard stats release notes changelog" },
        { id: "appearance", title: "Appearance", desc: "Theme, light or dark, and the body font.", keywords: "theme dark light font color" },
        { id: "editor", title: "Editor", desc: "Timestamps and writing preferences.", keywords: "toolbar markdown save time" },
        { id: "links", title: "Links", desc: "How links in your notes look and open.", keywords: "underline click external" },
        { id: "images", title: "Images", desc: "How images are stored, shown, and shared.", keywords: "attachments pictures cleanup" },
      ],
    },
    {
      label: "Your data",
      entries: [
        { id: "vault", title: "Vault", desc: "Your notes as plain Markdown files in a folder.", keywords: "export backup sync folder markdown files" },
        { id: "contexting", title: "Contexting", desc: "Shape what copying a note hands to other tools and AI.", keywords: "copy context clipboard ai" },
        ...(isMac
          ? [{ id: "import" as const, title: "Import", desc: "Bring in your Apple Stickies as notes.", keywords: "stickies apple migrate" }]
          : []),
      ],
    },
    {
      label: "Connections",
      entries: [
        { id: "agents", title: "Agents", desc: "Let Claude Code and other agents read and write your notes.", keywords: "mcp claude codex cursor ai access revert trace block tags" },
      ],
    },
    {
      label: "Help",
      entries: [
        { id: "about", title: "About", desc: "Version, platform, and project links.", keywords: "version license github" },
        { id: "feedback", title: "Feedback", desc: "Report a bug or send an idea.", keywords: "bug issue idea report" },
      ],
    },
  ];

  const TITLES: Record<Page, string> = Object.fromEntries(
    GROUPS.flatMap((g) => g.entries.map((e) => [e.id, e.title])),
  ) as Record<Page, string>;

  const shownGroups = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) => `${e.title} ${e.desc} ${e.keywords}`.toLowerCase().includes(q),
      ),
    })).filter((g) => g.entries.length > 0);
  });

  const searching = $derived(filter.trim() !== "");
  const results = $derived(
    shownGroups.flatMap((g) => g.entries.map((e) => ({ ...e, group: g.label }))),
  );

  function openPage(id: Page) {
    page = id;
    filter = "";
  }

  let stats = $state<DashboardStats | null>(null);
  let captureMs = $state<number | null>(null);
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
        if (document.activeElement === filterInput && filter) {
          e.preventDefault();
          filter = "";
          return;
        }
        e.preventDefault();
        if (page !== "home") page = "home";
        else onBack();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  function onFilterKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      const first = shownGroups[0]?.entries[0];
      if (first) openPage(first.id);
    }
  }

  const ACCESS_LABEL = { off: "Off", read: "Read only", write: "Read & write" } as const;
</script>

<div class="settings-root">
  <nav class="settings-nav" aria-label="Settings pages">
    <div class="pane-header" data-tauri-drag-region></div>
    <div class="nav-top">
      <button class="back-btn" onclick={onBack} title="Back to the library (Esc)">
        <span class="back-arrow" aria-hidden="true">&#8592;</span> Library
      </button>
      <h1 class="settings-title">Settings</h1>
    </div>
    <input
      class="nav-filter"
      type="search"
      placeholder="Find a setting…"
      aria-label="Find a setting"
      bind:value={filter}
      bind:this={filterInput}
      onkeydown={onFilterKeydown}
    />
    <div class="nav-groups">
      {#each shownGroups as group (group.label)}
        <div class="nav-group">
          <span class="nav-group-label">{group.label}</span>
          {#each group.entries as entry (entry.id)}
            <button
              class="nav-item"
              class:active={page === entry.id}
              aria-current={page === entry.id ? "page" : undefined}
              title={entry.desc}
              onclick={() => openPage(entry.id)}
            >
              {entry.title}
              {#if entry.id === "agents" && agents.unseen > 0}
                <span class="nav-badge">{agents.unseen}</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <p class="nav-empty">Nothing matches “{filter}”.</p>
      {/each}
    </div>
    <div class="nav-foot">
      <span class="nav-version">InstantNotes {appVersion ? `v${appVersion}` : ""}</span>
    </div>
  </nav>

  <div class="settings-main">
    {#if searching}
      <div class="pane-header" data-tauri-drag-region></div>
      <section class="settings-results" aria-label="Search results">
        {#each results as result (result.id)}
          <button class="result" onclick={() => openPage(result.id)}>
            <span class="result-title">{result.title}</span>
            <span class="result-group">{result.group}</span>
            <span class="result-desc">{result.desc}</span>
          </button>
        {:else}
          <p class="nav-empty">Nothing matches “{filter}”.</p>
        {/each}
      </section>
    {:else if page === "home"}
      <div class="pane-header" data-tauri-drag-region></div>
      <div class="settings-home">
        <header class="home-head">
          <h2 class="home-title">Overview</h2>
          <p class="home-sub">Your library at a glance, and what changed in this version.</p>
        </header>
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

        <section class="status-row" aria-label="Status">
          <div class="status">
            <span class="status-key">Theme</span>
            <span class="status-val">{theme.activeTheme.name} · {theme.resolvedVariant === "dark" ? "dark" : "light"}</span>
          </div>
          <div class="status">
            <span class="status-key">Agent access</span>
            <span class="status-val" data-on={agents.access !== "off"}>{ACCESS_LABEL[agents.access]}</span>
          </div>
          <div class="status">
            <span class="status-key">Agent calls traced</span>
            <span class="status-val">{agents.recent.length}</span>
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
      </div>
    {:else}
      <header class="pane-header page-head" data-tauri-drag-region>
        <nav class="crumb" aria-label="Breadcrumb">
          <button class="crumb-link" onclick={() => (page = "home")}>Settings</button>
          <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
          <span class="crumb-current">{TITLES[page]}</span>
        </nav>
      </header>
      <main class="settings-content">
        {#if page === "appearance"}
          <SettingsAppearance />
        {:else if page === "about"}
          <SettingsAbout {appVersion} />
        {:else if page === "editor"}
          <SettingsEditor />
        {:else if page === "images"}
          <SettingsImages />
        {:else if page === "contexting"}
          <SettingsContexting />
        {:else if page === "links"}
          <SettingsLinks />
        {:else if page === "vault"}
          <SettingsVault />
        {:else if page === "agents"}
          <SettingsAgents />
        {:else if page === "import"}
          <SettingsImport {onShowSpace} />
        {:else if page === "feedback"}
          <SettingsFeedback {appVersion} />
        {/if}
      </main>
    {/if}
  </div>
</div>

<style>
  .settings-root {
    display: grid;
    grid-template-columns: 228px minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--divider);
    padding: 0 10px 12px;
    gap: 10px;
  }
  .nav-top {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 4px;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    padding: 3px 8px 3px 6px;
    margin-left: -6px;
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 12.5px;
    font-family: var(--font-ui);
  }
  .back-btn:hover {
    background: var(--bg-hover);
  }
  .back-arrow {
    font-size: 13px;
  }
  .settings-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    font-family: var(--font-ui);
  }
  .nav-filter {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 12.5px;
    outline: none;
  }
  .nav-filter:focus {
    border-color: var(--accent);
  }
  .nav-filter::placeholder {
    color: var(--text-tertiary);
  }
  .nav-groups {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nav-group-label {
    padding: 0 10px;
    margin-bottom: 4px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border-radius: var(--radius);
    color: var(--text);
    font-size: 13px;
  }
  .nav-item:hover {
    background: var(--bg-hover);
  }
  .nav-item.active {
    background: var(--select-bg);
    font-weight: 600;
  }
  .nav-badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--bg);
    font-family: var(--font-meta);
    font-size: 10px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
  .nav-empty {
    margin: 8px 10px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .nav-foot {
    padding: 6px 10px 0;
    border-top: 1px solid var(--border);
  }
  .nav-version {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }

  .settings-main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .page-head {
    gap: 12px;
    padding: 0 40px;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
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
    color: var(--text-secondary);
  }
  .settings-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 40px 40px;
  }

  .settings-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 40px 40px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 820px;
  }
  .result {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 12px;
    text-align: left;
    padding: 10px 12px;
    border-radius: var(--radius);
    color: var(--text);
  }
  .result:hover {
    background: var(--bg-hover);
  }
  .result-title {
    font-size: 13px;
    font-weight: 600;
  }
  .result-group {
    align-self: center;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .result-desc {
    grid-column: 1 / -1;
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  .settings-home {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 40px 40px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 820px;
  }
  .home-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .home-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }
  .home-sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
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
  .status-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    padding: 10px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .status {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12.5px;
  }
  .status-key {
    color: var(--text-tertiary);
  }
  .status-val {
    color: var(--text);
    font-weight: 500;
  }
  .status-val[data-on="true"] {
    color: var(--success);
  }

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
</style>
