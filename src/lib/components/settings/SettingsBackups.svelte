<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    backupNow,
    getSetting,
    inspectBackup,
    listBackups,
    openBackupsFolder,
    restoreBackup,
    setBackupsAutomatic,
    setSetting,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import { isWeb } from "$lib/api/runtime";
  import type { BackupList } from "$lib/api/types";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { formatBytes, formatExact } from "$lib/format";
  import { exportArchiveDownload, exportVaultToFolder } from "$lib/vault-export";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  type Keep = "short" | "standard" | "long";
  type Every = "6" | "24" | "168";

  const KEEP_OPTIONS: { value: Keep; label: string }[] = [
    { value: "short", label: "Short" },
    { value: "standard", label: "Standard" },
    { value: "long", label: "Long" },
  ];

  const EVERY_OPTIONS: { value: Every; label: string }[] = [
    { value: "6", label: "6 hours" },
    { value: "24", label: "Daily" },
    { value: "168", label: "Weekly" },
  ];

  let list = $state<BackupList | null>(null);
  let busy = $state(false);
  let exporting = $state(false);
  let keep = $state<Keep>("standard");
  let every = $state<Every>("24");
  let keepTouched = false;
  let everyTouched = false;

  const errorMessage = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

  async function refresh() {
    try {
      list = await listBackups();
    } catch (e) {
      toasts.show(`Couldn't read backups: ${errorMessage(e)}`);
    }
  }

  onMount(() => {
    if (isWeb) return;
    void refresh();
    void getSetting<string>("backups.keep")
      .then((v) => {
        if (!keepTouched && (v === "short" || v === "standard" || v === "long")) keep = v;
      })
      .catch(() => {});
    void getSetting<number>("backups.everyHours")
      .then((v) => {
        if (!everyTouched && (v === 6 || v === 24 || v === 168)) every = String(v) as Every;
      })
      .catch(() => {});
    const unlisten = listen(EVENTS.BACKUPS_CHANGED, () => void refresh());
    return () => void unlisten.then((off) => off());
  });

  async function setAutomatic(on: boolean) {
    if (!list) return;
    list = { ...list, automatic: on };
    try {
      await setBackupsAutomatic(on);
    } catch (e) {
      toasts.show(`Couldn't change automatic backups: ${errorMessage(e)}`);
      void refresh();
    }
  }

  function setKeep(v: Keep) {
    keepTouched = true;
    keep = v;
    void setSetting("backups.keep", v);
  }

  function setEvery(v: Every) {
    everyTouched = true;
    every = v;
    void setSetting("backups.everyHours", Number(v));
  }

  async function runBackupNow() {
    if (busy) return;
    busy = true;
    try {
      list = await backupNow();
      toasts.show("Backed up");
    } catch (e) {
      toasts.show(`Couldn't back up: ${errorMessage(e)}`);
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
      const ok = await confirmDialog.ask({
        title: `Restore the library from ${when}?`,
        body: `${found.notes} ${found.notes === 1 ? "note" : "notes"} · restarts the app and turns sync off`,
        confirmLabel: "Restore and restart",
        tone: "danger",
      });
      if (!ok) return;
      await restoreBackup(path);
    } catch (e) {
      toasts.show(`Couldn't restore: ${errorMessage(e)}`);
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
      toasts.show(`Couldn't open file picker: ${errorMessage(e)}`);
      return;
    }
    if (!path || typeof path !== "string") return;
    await restore(path);
  }

  async function openFolder() {
    try {
      await openBackupsFolder();
    } catch (e) {
      toasts.show(`Couldn't open backups folder: ${errorMessage(e)}`);
    }
  }

  async function runExport() {
    if (exporting) return;
    exporting = true;
    try {
      const result = isWeb ? await exportArchiveDownload() : await exportVaultToFolder();
      if ("ok" in result && result.ok) {
        toasts.show("Exported");
      } else if ("error" in result) {
        toasts.show(`Couldn't export: ${result.error}`);
      }
    } finally {
      exporting = false;
    }
  }
</script>

<div class="backups-pane">
  {#if isWeb}
    <h2>Export</h2>
  {:else}
    <h2>Backups</h2>

    <ToggleRow
      label="Automatic backups"
      checked={list?.automatic ?? true}
      disabled={!list}
      onchange={(on) => void setAutomatic(on)}
    />

    <PrefRow
      label="Back up now"
      sub={list?.lastAt ? `Last backup ${formatExact(list.lastAt)}` : ""}
    >
      {#snippet control()}
        <button class="primary-btn" disabled={busy || !list} onclick={() => void runBackupNow()}>
          {busy ? "Working…" : "Back up now"}
        </button>
      {/snippet}
    </PrefRow>

    <details class="more">
      <summary>More</summary>
      <SegmentedRow
        label="Keep backups"
        options={KEEP_OPTIONS}
        value={keep}
        reset={keep !== "standard" ? () => setKeep("standard") : undefined}
        onchange={setKeep}
      />
      <SegmentedRow
        label="Back up every"
        options={EVERY_OPTIONS}
        value={every}
        reset={every !== "24" ? () => setEvery("24") : undefined}
        onchange={setEvery}
      />
    </details>

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
      <p class="fine-print">No backups yet</p>
    {/if}
    <div class="row-actions">
      <button class="card-btn" disabled={busy} onclick={() => void restoreFromFile()}>
        Restore from a file…
      </button>
      <button class="card-btn" onclick={() => void openFolder()}>Open backups folder</button>
    </div>

    <span class="group-label">Export</span>
  {/if}

  <PrefRow label="Export everything as Markdown">
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
  .more {
    margin-top: 12px;
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
