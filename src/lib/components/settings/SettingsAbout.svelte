<script lang="ts">
  import { onMount } from "svelte";
  import { getCaptureLatency, openUrl } from "$lib/api/client";
  import type { CaptureLatencySummary } from "$lib/api/types";

  let { appVersion }: { appVersion: string } = $props();

  // Reveal-to-ready timing for the capture panel; the number that keeps the
  // "capture is discharge" promise honest.
  let captureLatency = $state<CaptureLatencySummary | null>(null);
  onMount(() => {
    getCaptureLatency()
      .then((summary) => (captureLatency = summary))
      .catch(() => (captureLatency = null));
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
</style>
