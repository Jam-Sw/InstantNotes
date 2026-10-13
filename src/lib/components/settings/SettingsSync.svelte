<script lang="ts">
  import { onMount } from "svelte";
  import { exportVaultToFolder } from "$lib/vault-export";
  import {
    cancelSyncSignIn,
    disconnectSyncServer,
    getSyncServerStatus,
    getVaultStatus,
    setVaultFolder,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import type { SyncServerStatus, VaultStatus } from "$lib/api/types";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import SettingsVault from "$lib/components/settings/SettingsVault.svelte";
  import SyncServer from "$lib/components/settings/SyncServer.svelte";

  type Provider = "off" | "folder" | "server";

  const PROVIDERS: { value: Provider; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "folder", label: "Folder" },
    { value: "server", label: "Sync server" },
  ];

  let vault = $state<VaultStatus | null>(null);
  let server = $state<SyncServerStatus | null>(null);
  let picked = $state<Provider | null>(null);
  let switching = $state(false);
  let exporting = $state(false);

  const providerOf = (v: VaultStatus | null, s: SyncServerStatus | null): Provider =>
    s && s.stage !== "off" ? "server" : v?.path ? "folder" : "off";

  const active = $derived(providerOf(vault, server));
  const shown = $derived(picked ?? active);

  const errorMessage = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

  async function refresh() {
    try {
      const [v, s] = await Promise.all([getVaultStatus(), getSyncServerStatus()]);
      const before = providerOf(vault, server);
      const after = providerOf(v, s);
      if (after !== before) picked = after === "off" ? before : null;
      vault = v;
      server = s;
    } catch {
    }
  }

  onMount(() => {
    void refresh();
    const unlisten = listen(EVENTS.VAULT_STATUS, () => void refresh());
    return () => void unlisten.then((off) => off());
  });

  function currentName() {
    if (active === "folder") return "your folder";
    return server?.address?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "the sync server";
  }

  async function choose(next: Provider) {
    if (switching || next === shown) return;
    if (active !== "off" && next !== active) {
      const ok = await confirmDialog.ask({
        title: `Stop syncing with ${currentName()}?`,
        body: "Your notes stay on this device.",
        confirmLabel: "Stop syncing",
      });
      if (!ok) return;
      switching = true;
      try {
        if (active === "folder") await setVaultFolder(null);
        else if (server?.stage === "signingIn") await cancelSyncSignIn();
        else await disconnectSyncServer();
      } catch (e) {
        toasts.show(`Couldn't stop syncing: ${errorMessage(e)}`);
        return;
      } finally {
        switching = false;
      }
      await refresh();
    }
    picked = next;
  }

  async function runExport() {
    if (exporting) return;
    exporting = true;
    try {
      const result = await exportVaultToFolder();
      if ("cancelled" in result) {
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

<div class="sync-pane">
  <h2>Sync</h2>
  <p class="section-hint">
    Keep the same notes on every device you use, through a folder you already sync or through your
    own InstantNotes server.
  </p>

  <SegmentedRow
    label="Sync with"
    options={PROVIDERS}
    value={shown}
    disabled={switching || (!vault && !server)}
    onchange={choose}
  />

  {#if shown === "folder"}
    <SettingsVault />
  {:else if shown === "server"}
    <p class="provider-hint">
      Every device signed in to your InstantNotes server keeps the same library.
    </p>
    <SyncServer />
  {:else if vault || server}
    <p class="fine-print">Your notes are on this device only.</p>
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
  .sync-pane {
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
  .provider-hint {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
    margin: 16px 0 8px;
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
  .fine-print {
    margin: 4px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
