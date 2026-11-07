<script lang="ts">
  import { onMount } from "svelte";
  import {
    cancelSyncSignIn,
    disconnectSyncServer,
    getSetting,
    getSyncServerStatus,
    getVaultStatus,
    setSetting,
    setVaultFolder,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import { isWeb } from "$lib/api/runtime";
  import type { SyncServerStatus, VaultStatus } from "$lib/api/types";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import SettingsVault from "$lib/components/settings/SettingsVault.svelte";
  import SyncServer from "$lib/components/settings/SyncServer.svelte";

  type Provider = "off" | "folder" | "server";

  const PROVIDERS: { value: Provider; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "folder", label: "Folder" },
    { value: "server", label: "Sync server" },
  ];

  const DELAYS = [
    { value: "300", label: "300 ms" },
    { value: "2000", label: "2 s" },
    { value: "10000", label: "10 s" },
  ];

  const RETRIES = [
    { value: "10", label: "10 s" },
    { value: "30", label: "30 s" },
    { value: "60", label: "1 min" },
    { value: "300", label: "5 min" },
  ];

  let delay = $state("300");
  let retry = $state("30");
  let vault = $state<VaultStatus | null>(null);
  let server = $state<SyncServerStatus | null>(null);
  let picked = $state<Provider | null>(null);
  let switching = $state(false);

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
    } catch {}
  }

  async function loadTimings() {
    try {
      const [d, r] = await Promise.all([
        getSetting<number>("sync.delayMs"),
        getSetting<number>("sync.retrySec"),
      ]);
      if (DELAYS.some((o) => o.value === String(d))) delay = String(d);
      if (RETRIES.some((o) => o.value === String(r))) retry = String(r);
    } catch {}
  }

  function chooseDelay(v: string) {
    delay = v;
    void setSetting("sync.delayMs", Number(v));
  }

  function chooseRetry(v: string) {
    retry = v;
    void setSetting("sync.retrySec", Number(v));
  }

  onMount(() => {
    if (isWeb) {
      void loadTimings();
      return;
    }
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
</script>

<div class="sync-pane">
  <h2>Sync</h2>
  {#if isWeb}
    <SyncServer />
    <details class="more">
      <summary>More</summary>
      <SegmentedRow
        label="Sync delay"
        options={DELAYS}
        value={delay}
        reset={delay !== "300" ? () => chooseDelay("300") : undefined}
        onchange={chooseDelay}
      />
      <SegmentedRow
        label="Retry delay"
        options={RETRIES}
        value={retry}
        reset={retry !== "30" ? () => chooseRetry("30") : undefined}
        onchange={chooseRetry}
      />
    </details>
  {:else}
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
      <SyncServer />
    {/if}

  {/if}
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
</style>
