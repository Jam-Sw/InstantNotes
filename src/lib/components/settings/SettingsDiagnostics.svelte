<script lang="ts">
  import { onMount } from "svelte";
  import {
    deleteCrashReport,
    getSetting,
    listCrashReports,
    openUrl,
    readCrashReport,
    setSetting,
  } from "$lib/api/client";
  import type { CrashReport } from "$lib/api/types";
  import { isWeb } from "$lib/api/runtime";
  import { CRASH_PROMPT_SETTING, diagnosticsIssueUrl } from "$lib/diagnostics";
  import { buildReport } from "$lib/stores/diagnostics";
  import { toasts } from "$lib/stores/toasts.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  let prompt = $state(false);
  let reports = $state<CrashReport[]>([]);
  let report = $state<string | null>(null);
  let viewing = $state<{ name: string; text: string } | null>(null);

  function fail(what: string, e: unknown) {
    toasts.show(`Couldn't ${what}. ${e instanceof Error ? e.message : e}`);
  }

  async function refresh() {
    if (!isWeb) {
      reports = await listCrashReports().catch(() => []);
    }
    report = await buildReport().catch((e) => {
      fail("build the report", e);
      return "";
    });
  }

  onMount(() => {
    if (!isWeb) {
      void getSetting<boolean>(CRASH_PROMPT_SETTING)
        .then((v) => (prompt = v === true))
        .catch(() => {});
    }
    void refresh();
  });

  async function setPrompt(on: boolean) {
    prompt = on;
    try {
      await setSetting(CRASH_PROMPT_SETTING, on);
    } catch (e) {
      prompt = !on;
      fail("save the setting", e);
    }
  }

  async function view(name: string) {
    try {
      viewing = { name, text: await readCrashReport(name) };
    } catch (e) {
      fail("read the report", e);
    }
  }

  async function remove(name: string) {
    try {
      await deleteCrashReport(name);
      if (viewing?.name === name) viewing = null;
      await refresh();
    } catch (e) {
      fail("delete the report", e);
    }
  }

  function fullText(): string {
    const base = report ?? "";
    return viewing ? `${base}\n${viewing.name}:\n${viewing.text}` : base;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText());
      toasts.show("Copied the report.");
    } catch (e) {
      fail("copy the report", e);
    }
  }

  async function send() {
    try {
      await openUrl(diagnosticsIssueUrl(fullText()));
      toasts.show("GitHub is opening with the report filled in. Nothing is sent until you submit it there.");
    } catch (e) {
      fail("open GitHub", e);
    }
  }
</script>

<div class="diag-pane">
  <h2>Diagnostics</h2>
  <p class="section-hint">
    {#if isWeb}
      What this browser knows about InstantNotes, ready to hand over when something goes wrong.
    {:else}
      When something goes wrong, InstantNotes writes a short report beside your library. Nothing
      leaves this machine unless you send it.
    {/if}
  </p>

  {#if !isWeb}
    <ToggleRow
      label="Ask to review a crash report at the next launch"
      sub="Reports are always written; this decides whether the app brings them up."
      checked={prompt}
      onchange={(v) => void setPrompt(v)}
    />

    <h3>Crash reports</h3>
    {#if reports.length === 0}
      <p class="empty">No crash reports.</p>
    {:else}
      <ul class="reports" aria-label="Crash reports">
        {#each reports as r (r.name)}
          <li class="report-row">
            <span class="report-name">{r.name}</span>
            <button class="link" onclick={() => void view(r.name)}>View</button>
            <button class="link" onclick={() => void remove(r.name)}>Delete</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <h3>The report</h3>
  <pre class="report" aria-label="Diagnostics report">{report === null ? "Building…" : fullText()}</pre>
  <div class="actions">
    <button class="primary" disabled={!report} onclick={() => void send()}>Send</button>
    <button class="secondary" disabled={!report} onclick={() => void copy()}>Copy</button>
  </div>
  <p class="fine-print">
    It holds the version, platform, counts, sync and backup state, crash reports and recent log
    lines. It never holds note text, your server address, your name or paths outside the app's
    folder. Send opens a GitHub issue in your browser with exactly the text above; it is filed only
    when you submit it there.
  </p>
</div>

<style>
  .diag-pane {
    max-width: 640px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  h3 {
    margin: 20px 0 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 12px;
  }
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--text-tertiary);
  }
  .reports {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .report-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    font-size: 13px;
  }
  .report-row + .report-row {
    border-top: 1px solid var(--border);
  }
  .report-name {
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--text);
  }
  .link {
    color: var(--accent);
    font-size: 12.5px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .report {
    margin: 0;
    max-height: 320px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  .actions {
    margin-top: 14px;
    display: flex;
    gap: 10px;
  }
  .primary {
    padding: 8px 18px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .secondary {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
  }
  .fine-print {
    margin: 10px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
