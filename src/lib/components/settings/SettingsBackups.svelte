<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    backupNow,
    inspectBackup,
    listBackups,
    openBackupsFolder,
    restoreBackup,
    setBackupsAutomatic,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import { isWeb } from "$lib/api/runtime";
  import type { BackupList } from "$lib/api/types";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { formatBytes, formatExact } from "$lib/format";
  import { exportArchiveDownload, exportVaultToFolder } from "$lib/vault-export";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  let list = $state<BackupList | null>(null);
  let busy = $state(false);
  let exporting = $state(false);

  const errorMessage = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

  async function refresh() {
    try {
      list = await listBackups();
    } catch (e) {
      toasts.show(`Couldn't read the backups. ${errorMessage(e)}`);
    }
  }

  onMount(() => {
    if (isWeb) return;
    void refresh();
    const unlisten = listen(EVENTS.BACKUPS_CHANGED, () => void refresh());
    return () => void unlisten.then((off) => off());
  });

  async function setAutomatic(on: boolean) {
    if (!list) return;
    list = { ...list, automatic: on };
    try {
      await setBackupsAutomatic(on);
    } catch (e) {
      toasts.show(`Couldn't change the setting. ${errorMessage(e)}`);
      void refresh();
    }
  }

  async function runBackupNow() {
    if (busy) return;
    busy = true;
    try {
      list = await backupNow();
      toasts.show("Backed up. The copy is in the backups folder.");
    } catch (e) {
      toasts.show(`Couldn't back up. ${errorMessage(e)}`);
    } finally {
      busy = false;
    }
  }

  async function restore(path: string) {
    if (busy) return;
    busy = true;
    try {
      const found = await inspectBackup(path);
      const when = found.madeAt ? formatExact(found.madeAt) : "an unknown time";
      const notes = `${found.notes} ${found.notes === 1 ? "note" : "notes"}`;
      const ok = await confirmDialog.ask({
        title: `Restore the library from ${when}?`,
        body: `That copy holds ${notes}. InstantNotes restarts, keeps today's library as a backup, and turns sync off; turn it back on in Settings > Sync when ready.`,
        confirmLabel: "Restore and restart",
        tone: "danger",
      });
      if (!ok) return;
      await restoreBackup(path);
    } catch (e) {
      toasts.show(`Couldn't restore. ${errorMessage(e)}`);
    } finally {
      busy = false;
    }
  }

  async function restoreFromFile() {
    let path: string | string[] | null;
    try {
      path = await open({
        multiple: false,
        filters: [{ name: "InstantNotes library", extensions: ["db"] }],
      });
    } catch (e) {
      toasts.show(`Couldn't open the file picker. ${errorMessage(e)}`);
      return;
    }
    if (!path || typeof path !== "string") return;
    await restore(path);
  }

  async function openFolder() {
    try {
      await openBackupsFolder();
    } catch (e) {
      toasts.show(`Couldn't open the folder. ${errorMessage(e)}`);
    }
  }

  async function runExport() {
    if (exporting) return;
    exporting = true;
    try {
      const result = isWeb ? await exportArchiveDownload() : await exportVaultToFolder();
      if ("ok" in result && result.ok) {
        toasts.show(
          isWeb
            ? "Exported. The download holds every note as a plain Markdown file."
            : "Exported. Every note is now a plain Markdown file in the folder you chose.",
        );
      } else if ("error" in result) {
        toasts.show(`Couldn't export. ${result.error}`);
      }
    } finally {
      exporting = false;
    }
  }
</script>

<div class="backups-pane">
  {#if isWeb}
    <h2>Export</h2>
    <p class="section-hint">
      Your notes are kept on the server and on every signed-in device. Take a copy whenever you like.
    </p>
  {:else}
    <h2>Backups</h2>
    <p class="section-hint">
      A copy of your library is made every day and kept beside it. Images stay in the attachments folder;
      the Markdown export carries them.
    </p>

    <ToggleRow
      label="Automatic backups"
      sub="Once a day, while InstantNotes is open. A week of daily copies is kept, then one a week, then one a month."
      checked={list?.automatic ?? true}
      disabled={!list}
      onchange={(on) => void setAutomatic(on)}
    />

    <PrefRow
      label="Back up now"
      sub={!list ? "" : list.lastAt ? `Last backup ${formatExact(list.lastAt)}.` : "No backup yet."}
    >
      {#snippet control()}
        <button class="primary-btn" disabled={busy || !list} onclick={() => void runBackupNow()}>
          {busy ? "Working…" : "Back up now"}
        </button>
      {/snippet}
    </PrefRow>

    <span class="group-label">Restore</span>
    {#if list && list.backups.length > 0}
      <ul class="backup-list" aria-label="Backups">
        {#each list.backups as backup (backup.path)}
          <li class="backup-row">
            <span class="backup-when">{formatExact(backup.madeAt)}</span>
            <span class="backup-size">{formatBytes(backup.bytes)}</span>
            <button class="card-btn" disabled={busy} onclick={() => void restore(backup.path)}>
              Restore…
            </button>
          </li>
        {/each}
      </ul>
    {:else if list}
      <p class="fine-print">No backups yet. The first one is made a few seconds after launch.</p>
    {/if}
    <div class="row-actions">
      <button class="card-btn" disabled={busy} onclick={() => void restoreFromFile()}>
        Restore from a file…
      </button>
      <button class="card-btn" onclick={() => void openFolder()}>Open backups folder</button>
    </div>

    <span class="group-label">Export</span>
  {/if}

  <PrefRow
    label="Export everything as Markdown"
    sub={isWeb
      ? "A .zip with every note, tag, Space and image, as the folder export writes them."
      : "A snapshot of every note, tag, Space, and attachment, written once to a folder you choose."}
  >
    {#snippet control()}
      <button class="primary-btn" disabled={exporting} onclick={() => void runExport()}>
        {exporting ? "Exporting…" : isWeb ? "Download…" : "Export a copy…"}
      </button>
    {/snippet}
  </PrefRow>
</div>

<style>
  .backups-pane {
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
    margin: 28px 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .backup-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    max-height: 260px;
    overflow: auto;
  }
  .backup-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .backup-row + .backup-row {
    border-top: 1px solid var(--border);
  }
  .backup-when {
    flex: 1;
    color: var(--text);
  }
  .backup-size {
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    font-size: 12px;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .fine-print {
    color: var(--text-tertiary);
    font-size: 12px;
    margin: 8px 0 0;
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
    flex-shrink: 0;
    padding: 6px 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .primary-btn:disabled {
    opacity: 0.6;
  }
</style>
