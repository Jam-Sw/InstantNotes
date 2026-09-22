<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { exportVaultToFolder } from "$lib/vault-export";
  import { chooseVaultFolder, describeVaultReport } from "$lib/vault-mirror";
  import { getVaultStatus, setVaultFolder, verifyVault } from "$lib/api/client";
  import type { VaultStatus } from "$lib/api/types";
  import { toasts } from "$lib/stores/toasts.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";

  let status = $state<VaultStatus | null>(null);
  let busy = $state(false);
  let checking = $state(false);
  let reportLines = $state<string[]>([]);
  let exporting = $state(false);

  const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function refresh() {
    try {
      status = await getVaultStatus();
    } catch {
      // Keep whatever was last shown; the next vault:status event retries.
    }
  }

  onMount(() => {
    void refresh();
    // The background writer announces every flush, so pending counts and
    // errors stay current while this page is open.
    const unlisten = listen("vault:status", () => void refresh());
    return () => void unlisten.then((off) => off());
  });

  // A missing folder is the one error with an obvious fix, so it gets words
  // instead of the raw message.
  const statusLine = $derived.by(() => {
    if (!status?.path) return "";
    if (status.lastError) {
      return status.lastError.startsWith("vault folder not found")
        ? "Paused: the folder can't be found. Reconnect its drive or choose another folder."
        : `Paused: ${status.lastError}`;
    }
    if (status.pending > 0) {
      return `Writing ${status.pending} ${status.pending === 1 ? "note" : "notes"}…`;
    }
    return "Up to date";
  });

  async function chooseFolder() {
    if (busy) return;
    busy = true;
    try {
      const choice = await chooseVaultFolder();
      if ("cancelled" in choice) return;
      if ("error" in choice) {
        toasts.show(`Couldn't open the folder picker. ${choice.error}`);
        return;
      }
      status = await setVaultFolder(choice.path);
      reportLines = [];
    } catch (e) {
      toasts.show(`Couldn't use that folder: ${errorMessage(e)}`);
    } finally {
      busy = false;
    }
  }

  async function stopMirroring() {
    if (busy) return;
    busy = true;
    try {
      status = await setVaultFolder(null);
      reportLines = [];
      toasts.show("Stopped. The files already written stay in the folder.");
    } catch (e) {
      toasts.show(`Couldn't stop mirroring: ${errorMessage(e)}`);
    } finally {
      busy = false;
    }
  }

  async function checkVault() {
    if (checking) return;
    checking = true;
    try {
      reportLines = describeVaultReport(await verifyVault());
    } catch (e) {
      reportLines = [];
      toasts.show(`Couldn't check the vault: ${errorMessage(e)}`);
    } finally {
      checking = false;
      void refresh();
    }
  }

  async function runExport() {
    if (exporting) return;
    exporting = true;
    try {
      const result = await exportVaultToFolder();
      if ("cancelled" in result) {
        // Nothing to report.
      } else if (result.ok) {
        toasts.show("Exported. Every note is now a plain Markdown file in the folder you chose.");
      } else {
        toasts.show(`Couldn't export. ${result.error}`);
      }
    } finally {
      exporting = false;
    }
  }
</script>

<div class="vault-pane">
  <h2>Vault</h2>
  <p class="section-hint">
    Your notes as plain Markdown files, with their tags and Spaces, in a folder
    you choose. Readable and editable in any editor, with InstantNotes closed,
    on any device.
  </p>

  <span class="group-label">Live vault</span>
  {#if !status?.path}
    <PrefRow
      label="Keep a live copy in a folder"
      sub="Every change is written to the folder a moment after you make it. A synced folder carries your notes to your other devices."
    >
      {#snippet control()}
        <button class="primary-btn" disabled={busy || !status} onclick={chooseFolder}>
          Choose folder…
        </button>
      {/snippet}
    </PrefRow>
  {:else}
    <div class="vault-card">
      <div class="card-row">
        <span class="card-key">Folder</span>
        <span class="card-path" title={status.path}>{status.path}</span>
      </div>
      <div class="card-row">
        <span class="card-key">Status</span>
        <span class="card-status" class:paused={!!status.lastError}>{statusLine}</span>
      </div>
      <div class="card-actions">
        <button class="card-btn" disabled={checking} onclick={checkVault}>
          {checking ? "Checking…" : "Check vault"}
        </button>
        <button class="card-btn" disabled={busy} onclick={chooseFolder}>Change folder…</button>
        <button class="card-btn quiet" disabled={busy} onclick={stopMirroring}>
          Stop mirroring
        </button>
      </div>
    </div>
    {#if reportLines.length}
      <ul class="report" aria-label="Vault check result">
        {#each reportLines as line (line)}
          <li>{line}</li>
        {/each}
      </ul>
    {/if}
    <p class="fine-print">
      InstantNotes writes these files; it does not read them back yet. An edit
      made in the folder is replaced the next time that note changes here, and
      Check vault lists any file that no longer matches.
    </p>
  {/if}

  <span class="group-label">One-time copy</span>
  <PrefRow
    label="Export a copy"
    sub="A snapshot of every note, tag, Space, and attachment, written once to a folder you choose."
  >
    {#snippet control()}
      <button class="primary-btn" disabled={exporting} onclick={runExport}>
        {exporting ? "Exporting…" : "Export a copy…"}
      </button>
    {/snippet}
  </PrefRow>
</div>

<style>
  .vault-pane {
    max-width: 560px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
    margin: 0 0 20px;
  }
  .group-label {
    display: block;
    margin: 20px 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .primary-btn {
    flex-shrink: 0;
    padding: 6px 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .primary-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .primary-btn:disabled {
    opacity: 0.5;
  }
  .vault-card {
    margin-top: 8px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 5px 0;
  }
  .card-key {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-meta);
  }
  .card-path {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-meta);
    max-width: 380px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-status {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    text-align: right;
  }
  .card-status.paused {
    color: var(--danger);
  }
  .card-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
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
    opacity: 0.5;
  }
  .card-btn.quiet {
    margin-left: auto;
    color: var(--text-secondary);
  }
  .report {
    margin: 10px 0 0;
    padding-left: 18px;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
