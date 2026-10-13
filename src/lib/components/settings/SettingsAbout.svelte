<script lang="ts">
  import { onMount } from "svelte";
  import { getCaptureLatency } from "$lib/api/client";
  import type { CaptureLatencySummary } from "$lib/api/types";
  import { isWeb } from "$lib/api/runtime";
  import { runCommand } from "$lib/commands";
  import { formatExact } from "$lib/format";
  import { platformName } from "$lib/platform";
  import { updater } from "$lib/stores/updater.svelte";

  let { appVersion }: { appVersion: string } = $props();

  const platform = isWeb ? "Web app" : platformName();

  let captureLatency = $state<CaptureLatencySummary | null>(null);
  onMount(() => {
    if (isWeb) return;
    getCaptureLatency()
      .then((summary) => (captureLatency = summary))
      .catch(() => (captureLatency = null));
  });

  const updateLine = $derived.by(() => {
    const checked = updater.lastCheckedAt ? formatExact(updater.lastCheckedAt) : null;
    if (updater.status === "checking") return "Checking…";
    if (updater.pendingUpdate && updater.version) return `Update available: v${updater.version}`;
    if (updater.status === "error") return checked ? `Couldn't check. Last checked ${checked}` : "Couldn't check";
    if (updater.status === "uptodate" && checked) return `Up to date, checked ${checked}`;
    return checked ? `Last checked ${checked}` : "Last checked: never";
  });
</script>

<div class="about-pane">
  <img class="app-icon" src="/app-icon.png" alt="InstantNotes" />
  <h1 class="app-name">InstantNotes</h1>
  {#if appVersion}
    <span class="version-badge">v{appVersion}</span>
  {/if}
  <p class="tagline">Instant capture, organized knowledge.</p>

  <div class="about-details">
    <div class="detail-row">
      <span class="detail-key">{isWeb ? "Server version" : "Version"}</span>
      <span class="detail-val">{appVersion || "-"}</span>
    </div>
    <hr />
    <div class="detail-row">
      <span class="detail-key">Platform</span>
      <span class="detail-val">{platform}</span>
    </div>
    {#if !isWeb}
      <hr />
      <div class="detail-row">
        <span class="detail-key">Capture readiness</span>
        <span
          class="detail-val"
          title="Hotkey reveal to ready-for-typing, median of recent opens"
        >
          {#if captureLatency && captureLatency.medianMs !== null}
            {captureLatency.medianMs} ms
          {:else}
            Measured on first capture
          {/if}
        </span>
      </div>
    {/if}
  </div>

  <section class="about-details updates" aria-label="Updates">
    <div class="detail-row">
      <span class="detail-key">Updates</span>
      <span class="detail-val" aria-live="polite">
        {#if isWeb}The web app updates with your server{:else}{updateLine}{/if}
      </span>
    </div>
    {#if !isWeb}
      <div class="update-actions">
        <button
          class="card-btn"
          disabled={updater.status === "checking"}
          onclick={() => void runCommand("app.checkUpdates")}
        >
          Check for updates
        </button>
        {#if updater.pendingUpdate}
          <button class="primary-btn" onclick={() => void runCommand("app.showUpdate")}>
            Show update
          </button>
        {/if}
      </div>
    {/if}
  </section>

  <div class="about-links">
    <button class="detail-link" onclick={() => void runCommand("app.openRepo")}>
      Repository &#8599;
    </button>
    <button
      class="detail-link"
      onclick={() => void runCommand("app.openChangelog")}
    >
      Full changelog &#8599;
    </button>
    {#if !isWeb}
      <button class="detail-link" onclick={() => void runCommand("app.openDataFolder")}>
        Open data folder
      </button>
      <button class="detail-link" onclick={() => void runCommand("app.sendFeedback")}>
        Send feedback
      </button>
    {/if}
  </div>
</div>

<style>
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
  .about-details.updates {
    margin-top: 12px;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
  }
  .detail-key {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-meta);
    white-space: nowrap;
  }
  .detail-val {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    text-align: right;
  }
  .update-actions {
    display: flex;
    gap: 8px;
    padding-top: 8px;
  }
  .card-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .card-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .card-btn:disabled {
    opacity: 0.6;
  }
  .primary-btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .about-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 16px;
    margin-top: 16px;
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
</style>
