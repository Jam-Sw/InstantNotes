<script lang="ts">
  import { onMount } from "svelte";
  import SettingsAbout from "$lib/components/settings/SettingsAbout.svelte";
  import SettingsAppearance from "$lib/components/settings/SettingsAppearance.svelte";
  import SettingsMarkers from "$lib/components/settings/SettingsMarkers.svelte";
  import SettingsEditor from "$lib/components/settings/SettingsEditor.svelte";
  import SettingsImages from "$lib/components/settings/SettingsImages.svelte";
  import SettingsContexting from "$lib/components/settings/SettingsContexting.svelte";
  import SettingsLinks from "$lib/components/settings/SettingsLinks.svelte";
  import SettingsFeedback from "$lib/components/settings/SettingsFeedback.svelte";
  import SettingsDiagnostics from "$lib/components/settings/SettingsDiagnostics.svelte";
  import SettingsSync from "$lib/components/settings/SettingsSync.svelte";
  import SettingsBackups from "$lib/components/settings/SettingsBackups.svelte";
  import SettingsAgents from "$lib/components/settings/SettingsAgents.svelte";
  import SettingsImport from "$lib/components/settings/SettingsImport.svelte";
  import SettingsList from "$lib/components/settings/SettingsList.svelte";
  import SettingsGraph from "$lib/components/settings/SettingsGraph.svelte";
  import SettingsBehavior from "$lib/components/settings/SettingsBehavior.svelte";
  import { getLibraryStats, getCaptureLatency, openUrl } from "$lib/api/client";
  import { plugins } from "$lib/plugin";
  import type { DashboardStats } from "$lib/api/types";
  import { formatBytes } from "$lib/format";
  import { isMac } from "$lib/platform";
  import { isWeb } from "$lib/api/runtime";
  import { parseChangelog } from "$lib/changelog";
  import { theme } from "$lib/stores/theme.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { shell, type SettingsPage as Page } from "$lib/stores/shell.svelte";
  import { layout } from "$lib/stores/layout.svelte";
  import changelogRaw from "../../../CHANGELOG.md?raw";

  let {
    appVersion,
    onBack,
    onShowSpace,
  }: {
    appVersion: string;
    onBack: () => void;
    onShowSpace: (workspaceId: string) => void;
  } = $props();

  const page = $derived(shell.settingsPage);
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

  const DESKTOP_ONLY: ReadonlySet<Page> = new Set<Page>(["import", "agents", "feedback", "behavior"]);

  const pluginKeywords = plugins
    .flatMap((p) => [p.label, ...(p.prefs ?? []).map((spec) => spec.label)])
    .join(" ")
    .toLowerCase();

  const GROUPS: Group[] = (
    [
    {
      label: "General",
      entries: [
        { id: "home", title: "Overview", desc: "Stats, release notes", keywords: "dashboard stats release notes changelog" },
        { id: "appearance", title: "Appearance", desc: "Theme, mode, font", keywords: "theme dark light font color body font marker flag space marker motion density line height accent scrollbars toast time" },
        { id: "editor", title: "Editor", desc: "Width, timestamps, toolbar, suggestions", keywords: "toolbar markdown save time width exact save time source tag suggestions strictness around this note spellcheck wrap lines autosave delay indent width " + pluginKeywords },
        { id: "list", title: "List", desc: "Sort, reopen, preview, recent", keywords: "sort by order newest oldest reopen last note startup restore preview length recent notes" },
        { id: "graph", title: "Graph", desc: "Labels, size, spread, depth", keywords: "labels node size spread focus depth" },
        { id: "behavior", title: "Behavior", desc: "Shortcut, tray, updates, confirms", keywords: "capture shortcut close to tray check for updates confirm before pane width limit" },
        { id: "links", title: "Links", desc: "Underline, open behavior", keywords: "underline click external open links with show destination on hover mark external links" },
        { id: "images", title: "Images", desc: "Storage, preview, cleanup", keywords: "attachments pictures cleanup when adding an image maximum height preview linked folders" },
      ],
    },
    {
      label: "Your data",
      entries: [
        { id: "vault", title: "Sync", desc: isWeb ? "Server, devices, encryption" : "Folder or server", keywords: "vault folder server sign in encryption recovery key devices sync with sync delay retry delay" },
        isWeb
          ? { id: "backups" as const, title: "Export", desc: "Markdown download", keywords: "export backup markdown zip files download export everything as markdown" }
          : { id: "backups" as const, title: "Backups", desc: "Daily copies, restore, export", keywords: "backup restore export markdown files copy snapshot automatic backups back up now keep backups back up every" },
        { id: "contexting", title: "Contexting", desc: "Copy template", keywords: "copy context clipboard ai add source line images on copy" },
        { id: "import", title: "Import", desc: isMac ? "Obsidian, Notion, Apple Stickies" : "Obsidian, Notion", keywords: "obsidian notion vault export stickies apple migrate move" },
      ],
    },
    {
      label: "Connections",
      entries: [
        { id: "agents", title: "Agents", desc: "Access, tags, activity", keywords: "mcp claude codex cursor ai access revert trace block tags notify me about recent agent activity" },
      ],
    },
    {
      label: "Help",
      entries: [
        { id: "about", title: "About", desc: "Version, platform, links", keywords: "version license github" },
        { id: "feedback", title: "Feedback", desc: "Bugs and ideas", keywords: "bug issue idea report" },
        { id: "diagnostics", title: "Diagnostics", desc: "Crash reports, sendable report", keywords: "crash error log problem report debug" },
      ],
    },
    ] as Group[]
  )
    .map((g) => ({
      ...g,
      entries: isWeb ? g.entries.filter((e) => !DESKTOP_ONLY.has(e.id)) : g.entries,
    }))
    .filter((g) => g.entries.length > 0);

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
  let overview = $state(false);
  const navPane = $derived(page === "home" && !overview);
  const results = $derived(
    shownGroups.flatMap((g) => g.entries.map((e) => ({ ...e, group: g.label }))),
  );

  function openPage(id: Page) {
    shell.settingsPage = id;
    overview = id === "home";
    filter = "";
  }

  let stats = $state<DashboardStats | null>(null);
  let captureMs = $state<number | null>(null);
  const release = $derived(parseChangelog(changelogRaw, appVersion));
  function codeSpans(text: string): { text: string; code: boolean }[] {
    const parts: { text: string; code: boolean }[] = [];
    let plain = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] !== "`") {
        plain += text[i++];
        continue;
      }
      let n = 0;
      while (text[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const runs = /`+/g;
      runs.lastIndex = i + n;
      let end = -1;
      for (let m = runs.exec(text); m; m = runs.exec(text)) {
        if (m[0].length === n) {
          end = m.index;
          break;
        }
      }
      if (end === -1) {
        plain += fence;
        i += n;
        continue;
      }
      let inner = text.slice(i + n, end);
      if (inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) inner = inner.slice(1, -1);
      if (plain) parts.push({ text: plain, code: false });
      plain = "";
      parts.push({ text: inner, code: true });
      i = end + n;
    }
    if (plain) parts.push({ text: plain, code: false });
    return parts;
  }

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
        if (page !== "home") shell.settingsPage = "home";
        else if (overview && layout.phone) overview = false;
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

<div class="settings-root" class:phone={layout.phone} data-pane={navPane ? "nav" : "main"}>
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
              class:active={!layout.phone && page === entry.id}
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
      <div class="pane-header" data-tauri-drag-region>
        {#if layout.phone}
          <button class="back-btn" aria-label="Back to Settings" onclick={() => (overview = false)}>
            <span class="back-arrow" aria-hidden="true">&#8592;</span> Settings
          </button>
        {/if}
      </div>
      <div class="settings-home">
        <header class="home-head">
          <div class="home-heading">
            <h2 class="home-title">Overview</h2>
            <p class="home-sub">Library stats and release notes</p>
          </div>
          <dl class="status-row" aria-label="Status">
            <div class="status">
              <dt class="status-key">Theme</dt>
              <dd class="status-val">{theme.activeTheme.name} · {theme.resolvedVariant === "dark" ? "dark" : "light"}</dd>
            </div>
            <div class="status">
              <dt class="status-key">Agent access</dt>
              <dd class="status-val" data-on={agents.access !== "off"}>{ACCESS_LABEL[agents.access]}</dd>
            </div>
            <div class="status">
              <dt class="status-key">Agent calls traced</dt>
              <dd class="status-val">{agents.recent.length}</dd>
            </div>
          </dl>
        </header>

        <section class="stat-grid" aria-label="Library stats">
          <div class="stat">
            <span class="stat-label">Notes</span>
            <span class="stat-num">{stats?.notesTotal ?? "–"}</span>
            <span class="stat-sub">{stats ? `${stats.notesPinned} pinned · ${stats.notesArchived} archived` : ""}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Tags</span>
            <span class="stat-num">{stats?.tags ?? "–"}</span>
            <span class="stat-sub"></span>
          </div>
          <div class="stat">
            <span class="stat-label">Spaces</span>
            <span class="stat-num">{stats?.spaces ?? "–"}</span>
            <span class="stat-sub"></span>
          </div>
          <div class="stat">
            <span class="stat-label">Attachments</span>
            <span class="stat-num">{stats?.attachmentsCount ?? "–"}</span>
            <span class="stat-sub">{stats ? formatBytes(stats.attachmentsBytes) : ""}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Capture</span>
            <span class="stat-num"
              >{#if captureMs !== null}{captureMs}<span class="stat-unit">ms</span>{:else}–{/if}</span
            >
            <span class="stat-sub">reveal to ready</span>
          </div>
          <div class="stat">
            <span class="stat-label">In Trash</span>
            <span class="stat-num">{stats?.notesTrashed ?? "–"}</span>
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
                    <li>
                      {#each codeSpans(item) as part, j (j)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}
                    </li>
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
        {#if layout.phone}
          <button class="back-btn" aria-label="Back to Settings" onclick={() => (shell.settingsPage = "home")}>
            <span class="back-arrow" aria-hidden="true">&#8592;</span> Settings
          </button>
        {/if}
        <nav class="crumb" aria-label="Breadcrumb">
          <button class="crumb-link" onclick={() => (shell.settingsPage = "home")}>Settings</button>
          <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
          <span class="crumb-current">{TITLES[page]}</span>
        </nav>
      </header>
      <main class="settings-content">
        {#if page === "appearance"}
          <SettingsAppearance />
          <SettingsMarkers />
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
          <SettingsSync />
        {:else if page === "backups"}
          <SettingsBackups />
        {:else if page === "agents"}
          <SettingsAgents />
        {:else if page === "list"}
          <SettingsList />
        {:else if page === "graph"}
          <SettingsGraph />
        {:else if page === "behavior"}
          <SettingsBehavior />
        {:else if page === "import"}
          <SettingsImport {onShowSpace} />
        {:else if page === "feedback"}
          <SettingsFeedback {appVersion} />
        {:else if page === "diagnostics"}
          <SettingsDiagnostics />
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
    height: var(--app-height, 100dvh);
    overflow: hidden;
    background: var(--bg);
  }

  .settings-root.phone {
    grid-template-columns: minmax(0, 1fr);
  }
  .phone[data-pane="nav"] .settings-main,
  .phone[data-pane="main"] .settings-nav {
    display: none;
  }
  .phone .settings-nav {
    border-right: none;
  }
  .phone .page-head {
    padding: 0 16px;
  }
  .phone .crumb {
    display: none;
  }
  .phone .pane-header .back-btn {
    align-self: center;
    margin-left: 0;
  }
  .phone .settings-content {
    padding: 16px 16px calc(40px + env(safe-area-inset-bottom));
  }
  .phone .settings-home {
    padding: 4px 16px calc(40px + env(safe-area-inset-bottom));
  }
  .phone .settings-results {
    padding: 4px 16px calc(40px + env(safe-area-inset-bottom));
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
    padding: 4px 48px 48px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    max-width: 1040px;
  }
  .settings-home > * {
    flex-shrink: 0;
  }
  .home-head {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }
  .home-heading {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .home-title {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .home-sub {
    margin: 0;
    font-size: 13.5px;
    color: var(--text-secondary);
  }
  .status-row {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 28px;
  }
  .status {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12.5px;
  }
  .status-key {
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-val {
    margin: 0;
    color: var(--text);
    font-weight: 500;
  }
  .status-val[data-on="true"] {
    color: var(--success);
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    overflow: hidden;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 18px 14px;
    min-width: 0;
  }
  .stat:not(:nth-child(3n + 1)) {
    border-left: 1px solid var(--border);
  }
  .stat:nth-child(n + 4) {
    border-top: 1px solid var(--border);
  }
  .stat-num {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-family: var(--font-ui);
    line-height: 1;
  }
  .stat-unit {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0;
    color: var(--text-tertiary);
    margin-left: 3px;
  }
  .stat-label {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--font-meta);
  }
  .stat-sub {
    font-size: 11.5px;
    color: var(--text-tertiary);
    min-height: 14px;
  }

  .whatsnew {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-left: 18px;
    border-left: 2px solid var(--accent-soft);
    max-width: 72ch;
  }
  .wn-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .wn-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-ui);
  }
  .wn-date {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .wn-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wn-kind {
    align-self: flex-start;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-text);
    background: var(--accent-soft);
    border-radius: 99px;
    padding: 2px 9px;
    font-family: var(--font-meta);
  }
  .wn-list {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wn-list li {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .wn-list li::marker {
    color: var(--text-tertiary);
  }
  .wn-list code {
    font-family: var(--font-meta);
    font-size: 11.5px;
    color: var(--text);
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .wn-link {
    align-self: flex-start;
    color: var(--accent);
    font-size: 12.5px;
  }
  .wn-link:hover {
    text-decoration: underline;
  }
  .phone .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .phone .stat:not(:nth-child(3n + 1)) {
    border-left: 0;
  }
  .phone .stat:nth-child(even) {
    border-left: 1px solid var(--border);
  }
  .phone .stat:nth-child(n + 3) {
    border-top: 1px solid var(--border);
  }
  .phone .whatsnew {
    padding-left: 14px;
  }
</style>
