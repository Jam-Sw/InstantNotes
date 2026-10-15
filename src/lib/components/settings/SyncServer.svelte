<script lang="ts">
  import { onMount } from "svelte";
  import {
    acceptPlainServer,
    cancelSyncSignIn,
    clearBrowserLibrary,
    confirmRecoverySaved,
    confirmSyncJoin,
    confirmSyncRemovals,
    connectSyncServer,
    disconnectSyncServer,
    enterRecoveryKey,
    getSyncServerStatus,
    listSyncDevices,
    revokeSyncDevice,
    setSyncEncryption,
    showRecoveryKey,
    startSyncJoin,
  } from "$lib/api/client";
  import { EVENTS, listen } from "$lib/api/events";
  import { isWeb } from "$lib/api/runtime";
  import type { SyncDevice, SyncServerStatus, SyncStage } from "$lib/api/types";
  import { timeAgo } from "$lib/agent-activity";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";
  import RecoveryKey from "$lib/components/settings/RecoveryKey.svelte";

  const CONNECTED: ReadonlySet<SyncStage> = new Set<SyncStage>([
    "syncing",
    "upToDate",
    "held",
    "problem",
    "refused",
    "offline",
    "signedOut",
  ]);
  const ENCRYPTION_ON =
    "Your server stores your notes encrypted. Only your devices can read them. New devices are approved from one you already use; keep your recovery key safe.";
  const ENCRYPTION_OFF =
    "Your server can read your notes, and so can anyone with its backups. New devices only need to sign in.";

  let status = $state<SyncServerStatus | null>(null);
  let address = $state("");
  let encrypt = $state(true);
  let failure = $state("");
  let cancelling = false;
  let busy = $state(false);
  let saved = $state(false);
  let recoveryText = $state("");
  let shownKey = $state("");
  let switching = $state(false);
  let switchError = $state("");
  let devices = $state<SyncDevice[] | null>(null);
  let devicesError = $state("");
  let now = $state(Date.now());

  const errorMessage = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

  const stage = $derived(status?.stage ?? "off");
  const connected = $derived(CONNECTED.has(stage));
  const reachable = $derived(connected && stage !== "offline" && stage !== "signedOut");
  const host = $derived(status?.address ? status.address.replace(/^https?:\/\//, "").replace(/\/$/, "") : "");

  function hold(next: SyncServerStatus) {
    if (status?.stage === "confirmJoin" && next.stage === "off") return;
    status = next;
    if (!address && next.address) address = host || next.address;
  }

  async function refresh() {
    try {
      hold(await getSyncServerStatus());
    } catch {
    }
  }

  async function loadDevices() {
    try {
      devices = await listSyncDevices();
      devicesError = "";
      now = Date.now();
    } catch (e) {
      devicesError = errorMessage(e);
    }
  }

  onMount(() => {
    void refresh();
    const unlisten = listen(EVENTS.VAULT_STATUS, () => void refresh());
    return () => void unlisten.then((off) => off());
  });

  $effect(() => {
    if (reachable) void loadDevices();
  });

  let asked = false;
  $effect(() => {
    if (stage !== "needsKey" || status?.message || asked) return;
    asked = true;
    void act(startSyncJoin, "Couldn't ask for approval");
  });

  async function signIn(to: string, withEncryption: boolean) {
    failure = "";
    cancelling = false;
    try {
      status = await connectSyncServer(to, withEncryption);
    } catch (e) {
      if (!cancelling) failure = errorMessage(e);
      await refresh();
    }
  }

  async function cancelSignIn() {
    cancelling = true;
    try {
      await cancelSyncSignIn();
    } finally {
      await refresh();
    }
  }

  async function act(run: () => Promise<unknown>, failed: string) {
    if (busy) return;
    busy = true;
    try {
      const next = await run();
      if (next && typeof next === "object" && "stage" in next) status = next as SyncServerStatus;
      else await refresh();
    } catch (e) {
      toasts.show(`${failed}: ${errorMessage(e)}`);
    } finally {
      busy = false;
    }
  }

  async function answerJoin(combine: boolean) {
    if (busy) return;
    busy = true;
    try {
      status = await confirmSyncJoin(combine);
    } catch (e) {
      failure = errorMessage(e);
      try {
        status = await getSyncServerStatus();
      } catch {
      }
    } finally {
      busy = false;
    }
  }

  async function setUp() {
    if (busy) return;
    busy = true;
    try {
      await signIn(location.host, encrypt);
    } finally {
      busy = false;
    }
  }

  async function signOut() {
    const ok = await confirmDialog.ask({
      title: isWeb ? "Sign out of this browser?" : `Stop syncing with ${host}?`,
      body: isWeb
        ? "This browser's copy of your notes is removed. They stay on your server and your other devices."
        : "Your notes stay on this device.",
      confirmLabel: "Sign out",
    });
    if (ok) await act(disconnectSyncServer, "Couldn't sign out");
  }

  async function useRecoveryKey() {
    if (busy || !recoveryText.trim()) return;
    busy = true;
    failure = "";
    try {
      status = await enterRecoveryKey(recoveryText.trim());
      recoveryText = "";
    } catch (e) {
      failure = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function finishRecovery() {
    await act(confirmRecoverySaved, "Couldn't continue");
    saved = false;
  }

  async function trashHeld() {
    try {
      await confirmSyncRemovals();
      toasts.show("They'll move to the Trash on the next sync.");
    } catch (e) {
      toasts.show(`Couldn't do that: ${errorMessage(e)}`);
    }
    await refresh();
  }

  async function flipEncryption(on: boolean) {
    const ok = await confirmDialog.ask(
      on
        ? {
            title: "Turn on end-to-end encryption?",
            body: "Your library is uploaded again, encrypted, and you get a recovery key to save. Your other devices stop syncing until you approve them from this one. Server backups taken while encryption was off still hold your notes unencrypted.",
            confirmLabel: "Turn on",
          }
        : {
            title: "Turn off end-to-end encryption?",
            body: "Your library is uploaded again, unencrypted. Your server, and anyone with its backups, can read your notes. Every device deletes its copy of the key.",
            confirmLabel: "Turn off",
            tone: "danger",
          },
    );
    if (!ok) return;
    switching = true;
    switchError = "";
    try {
      status = await setSyncEncryption(on);
    } catch (e) {
      switchError = errorMessage(e);
    } finally {
      switching = false;
    }
  }

  async function showAgain() {
    try {
      shownKey = await showRecoveryKey();
    } catch (e) {
      toasts.show(`Couldn't show the recovery key: ${errorMessage(e)}`);
    }
  }

  async function revoke(device: SyncDevice) {
    const ok = await confirmDialog.ask({
      title: `Revoke ${device.name}?`,
      body: "It stops syncing until someone signs in on it again. The notes already on it stay there.",
      confirmLabel: "Revoke",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeSyncDevice(device.id);
      await loadDevices();
    } catch (e) {
      toasts.show(`Couldn't revoke ${device.name}: ${errorMessage(e)}`);
    }
  }

  async function signOutEverywhere() {
    const ok = await confirmDialog.ask({
      title: "Sign out everywhere?",
      body: "Every device, this one included, stops syncing until it signs in again. Your notes stay on each device.",
      confirmLabel: "Sign out everywhere",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeSyncDevice(null);
    } catch (e) {
      toasts.show(`Couldn't sign out everywhere: ${errorMessage(e)}`);
    }
    await refresh();
  }

  function seen(device: SyncDevice) {
    const ago = timeAgo(device.lastSeen * 1000, now);
    return device.browser ? `Browser, seen ${ago}` : `Seen ${ago}`;
  }

  function notes(n: number) {
    return n === 1 ? "1 note" : `${n} notes`;
  }

  const statusLine = $derived.by((): { line: string; warn: boolean; note: string } => {
    const why = status?.message ? status.message.replace(/^./, (c) => c.toUpperCase()).replace(/\.?$/, ".") : "";
    switch (stage) {
      case "upToDate":
        return {
          line: status?.lastSyncedAt
            ? `Up to date as of ${new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "Up to date",
          warn: false,
          note: "",
        };
      case "held":
        return { line: "Held", warn: true, note: "" };
      case "problem":
        return { line: "Problem", warn: true, note: why };
      case "refused":
        return { line: "Stopped", warn: true, note: why };
      case "offline":
        return { line: "Offline", warn: true, note: `${why} Your changes wait and sync when it's back.`.trim() };
      case "signedOut":
        return { line: "Signed out", warn: true, note: "Nothing syncs until you sign in again. Your notes stay on this device." };
      default:
        return { line: "Syncing…", warn: false, note: "" };
    }
  });
</script>

{#snippet recoveryForm()}
  <form
    class="key-form"
    onsubmit={(e) => {
      e.preventDefault();
      void useRecoveryKey();
    }}
  >
    <label class="field-label" for="sync-recovery-key">Recovery key</label>
    <div class="key-row">
      <input
        id="sync-recovery-key"
        class="text-field key-field"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="AGE-SECRET-KEY-1…"
        bind:value={recoveryText}
      />
      <button class="card-btn" type="submit" disabled={busy || !recoveryText.trim()}>Use recovery key</button>
    </div>
  </form>
  {#if failure}
    <p class="failure" role="alert">{failure}</p>
  {/if}
{/snippet}

{#if status && stage === "off" && isWeb}
  <div class="vault-card step">
    <p class="lead">This server has no library yet.</p>
    <p class="detail">Set it up from this browser.</p>
    <div class="card-actions">
      <button class="primary-btn" disabled={busy} onclick={setUp}>
        {busy ? "Setting up…" : "Set up"}
      </button>
    </div>
  </div>
  {#if failure || status.message}
    <p class="failure" role="alert">Couldn't set up: {failure || status.message}</p>
  {/if}
{:else if status && stage === "off"}
  <PrefRow label="Server address" sub="The address of your InstantNotes server.">
    {#snippet control()}
      <form
        class="address-form"
        onsubmit={(e) => {
          e.preventDefault();
          if (address.trim()) void signIn(address.trim(), encrypt);
        }}
      >
        <input
          class="text-field address"
          type="text"
          inputmode="url"
          autocomplete="url"
          spellcheck="false"
          placeholder="notes.example.org"
          aria-label="Server address"
          bind:value={address}
        />
        <button class="primary-btn" type="submit" disabled={!address.trim()}>Sign in…</button>
      </form>
    {/snippet}
  </PrefRow>
  {#if failure || status?.message}
    <p class="failure" role="alert">Couldn't sign in: {failure || status?.message}</p>
  {/if}
{:else if stage === "signingIn"}
  <div class="vault-card step">
    {#if status?.pairingCode}
      <p class="lead">
        <span class="pulse" aria-hidden="true"></span>On any device with a browser, open
        {status.pairingUrl} and enter this code:
      </p>
      <p class="detail"><strong>{status.pairingCode}</strong></p>
      <p class="detail">{host}</p>
    {:else}
      <p class="lead"><span class="pulse" aria-hidden="true"></span>Finish signing in in your browser.</p>
      <p class="detail">{host}</p>
    {/if}
    <div class="card-actions">
      <button class="card-btn" onclick={cancelSignIn}>Cancel</button>
    </div>
  </div>
{:else if stage === "confirmJoin" && status}
  <div class="vault-card step">
    <p class="lead">
      This server holds {status.serverItems} items and this device has {notes(status.localNotes)}.
      They'll be combined into one library.
    </p>
    <p class="detail">
      Exact copies are combined; anything that might be the same note is kept twice and shown to you
      to decide. This device's library is backed up first.
    </p>
    <div class="card-actions">
      <button class="primary-btn" disabled={busy} onclick={() => answerJoin(true)}>
        Combine
      </button>
      <button class="card-btn" disabled={busy} onclick={() => answerJoin(false)}>
        Cancel
      </button>
    </div>
  </div>
{:else if stage === "recoveryKey" && status?.recoveryKey}
  <div class="vault-card step">
    <p class="lead">
      If you lose this recovery key and every device you use, your notes cannot be recovered by anyone,
      including whoever runs your server.
    </p>
    <RecoveryKey recoveryKey={status.recoveryKey} />
    <div class="card-actions saved-row">
      <label class="check">
        <input type="checkbox" bind:checked={saved} />
        I saved it somewhere safe
      </label>
      <button class="primary-btn" disabled={!saved || busy} onclick={finishRecovery}>Continue</button>
    </div>
  </div>
{:else if stage === "needsKey"}
  <div class="vault-card step">
    <p class="lead">Approve this device on one you already use, or enter your recovery key.</p>
    {#if status?.message}
      <p class="detail warn" role="alert">{status.message}</p>
    {/if}
    <div class="card-actions">
      <button class="primary-btn" disabled={busy} onclick={() => act(startSyncJoin, "Couldn't ask for approval")}>
        Approve on another device
      </button>
    </div>
    {@render recoveryForm()}
  </div>
{:else if stage === "joining" && status?.joinWords}
  <div class="vault-card step">
    <ol class="words" aria-label="Six words">
      {#each status.joinWords as word, i (i)}
        <li><span class="ordinal" aria-hidden="true">{i + 1}</span><span class="word">{word}</span></li>
      {/each}
    </ol>
    <p class="lead">Check that the same six words show on the device you approve from.</p>
    <p class="detail"><span class="pulse" aria-hidden="true"></span>Waiting for approval</p>
    {@render recoveryForm()}
  </div>
{:else if stage === "confirmPlain"}
  <div class="vault-card step">
    <p class="lead">This server keeps notes unencrypted. Sync with it anyway?</p>
    <div class="card-actions">
      <button class="primary-btn" disabled={busy} onclick={() => act(acceptPlainServer, "Couldn't sync")}>
        Sync anyway
      </button>
      <button class="card-btn" disabled={busy} onclick={() => act(disconnectSyncServer, "Couldn't cancel")}>
        Cancel
      </button>
    </div>
  </div>
{:else if stage === "otherLibrary"}
  <div class="vault-card step">
    <p class="lead">This browser holds notes from another library, so it won't sync them into yours.</p>
    <p class="detail">Clear this browser's copy to use your own library here. Those notes stay on their own server.</p>
    <div class="card-actions">
      <button class="primary-btn" disabled={busy} onclick={() => act(clearBrowserLibrary, "Couldn't clear this browser")}>
        Clear this browser
      </button>
    </div>
  </div>
{:else if connected && status}
  <div class="vault-card">
    <div class="card-row">
      <span class="card-key">Server</span>
      <span class="card-path" title={status.address ?? undefined}>{host}</span>
    </div>
    {#if status.person}
      <div class="card-row">
        <span class="card-key">Signed in as</span>
        <span class="card-status">{status.person}</span>
      </div>
    {/if}
    <div class="card-row">
      <span class="card-key">Status</span>
      <span class="card-status" class:paused={statusLine.warn}>{statusLine.line}</span>
    </div>
    {#if statusLine.note}
      <p class="card-note">{statusLine.note}</p>
    {/if}
    {#if status.conflicts > 0}
      <div class="card-row">
        <span class="card-key">Conflicts</span>
        <span class="card-status">
          {notes(status.conflicts)} changed in two places; both versions are kept, the other tagged #conflict
        </span>
      </div>
    {/if}
    {#if status.tooLarge.length > 0}
      <ul class="too-large" aria-label="Not synced">
        {#each status.tooLarge as name (name)}
          <li><span class="name">{name}</span>: too large for this server, kept on this device only</li>
        {/each}
      </ul>
    {/if}
    {#if status.heldRemovals > 0}
      <div class="held" role="alert">
        <p>
          {notes(status.heldRemovals)} went missing from the server at once. Nothing was removed. If these
          notes were deleted on another device, move them to the Trash here too.
        </p>
        <button class="card-btn" disabled={busy} onclick={trashHeld}>
          Move {notes(status.heldRemovals)} to Trash
        </button>
      </div>
    {/if}
    <div class="card-actions">
      {#if stage === "signedOut"}
        <button class="primary-btn" onclick={() => signIn(status?.address ?? "", status?.encrypted ?? true)}>
          Sign in again
        </button>
      {/if}
      <button class="card-btn quiet" disabled={busy} onclick={signOut}>
        {isWeb ? "Sign out of this browser" : "Sign out"}
      </button>
    </div>
  </div>
  {#if failure}
    <p class="failure" role="alert">Couldn't sign in: {failure}</p>
  {/if}
{/if}

{#if status && (stage === "off" || connected)}
  <span class="group-label">Security</span>
  <ToggleRow
    label="End-to-end encryption"
    sub={(connected ? status?.encrypted : encrypt) ? ENCRYPTION_ON : ENCRYPTION_OFF}
    checked={connected ? (status?.encrypted ?? false) : encrypt}
    disabled={switching || busy || (connected && !reachable)}
    onchange={(on) => (connected ? flipEncryption(on) : (encrypt = on))}
  />
  {#if switching}
    <p class="fine-print">Uploading your library again. Keep InstantNotes open until this finishes.</p>
  {:else if switchError}
    <p class="failure" role="alert">Couldn't switch: {switchError}</p>
  {/if}
  {#if connected}
    {#if status?.encrypted}
      <PrefRow label="Recovery key" sub="Needed only if you lose every device you use.">
        {#snippet control()}
          {#if shownKey}
            <button class="card-btn" onclick={() => (shownKey = "")}>Hide</button>
          {:else}
            <button class="card-btn" onclick={showAgain}>Show again</button>
          {/if}
        {/snippet}
      </PrefRow>
      {#if shownKey}
        <div class="shown-key">
          <RecoveryKey recoveryKey={shownKey} />
        </div>
      {/if}
    {/if}
    {#if reachable}
      <div class="devices">
        <span class="devices-label">Devices</span>
        {#if devices}
          <ul>
            {#each devices as device (device.id)}
              <li class="device">
                <span class="device-name">
                  {device.name}
                  <span class="device-meta">
                    {device.current ? "This device" : seen(device)}
                  </span>
                </span>
                {#if !device.current}
                  <button class="card-btn" onclick={() => revoke(device)}>Revoke</button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if devicesError}
          <p class="fine-print">Couldn't list devices: {devicesError}</p>
        {/if}
        <button class="card-btn danger" onclick={signOutEverywhere}>Sign out everywhere</button>
      </div>
    {/if}
  {/if}
{/if}

<style>
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
  .text-field {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 12.5px;
    font-family: var(--font-meta);
    outline: none;
  }
  .text-field:focus {
    border-color: var(--accent);
  }
  .address-form {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .address {
    width: 200px;
  }
  .key-form {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .field-label {
    display: block;
    margin-bottom: 6px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .key-row {
    display: flex;
    gap: 8px;
  }
  .key-field {
    flex: 1;
    min-width: 0;
  }
  .failure {
    margin: 8px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--danger);
  }
  .vault-card {
    margin-top: 8px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .vault-card.step {
    padding: 16px;
  }
  .lead {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text);
  }
  .detail {
    margin: 6px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .detail.warn {
    color: var(--danger);
  }
  .step :global(.recovery) {
    margin-top: 14px;
  }
  .pulse {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: 1px;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
  .words {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .words li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 12px 13px;
    background: var(--surface-list);
    font-size: 20px;
    font-weight: 500;
    line-height: 1.2;
    color: var(--text);
  }
  .ordinal {
    flex: none;
    min-width: 0.8em;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }
  .word {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .card-note {
    margin: 2px 0 4px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  @media (max-width: 480px) {
    .words {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .saved-row {
    align-items: center;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: auto;
    font-size: 13px;
    color: var(--text);
  }
  .check input {
    accent-color: var(--accent);
  }
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 5px 0;
  }
  .card-key {
    flex-shrink: 0;
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
  .too-large {
    margin: 6px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    list-style: none;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .too-large .name {
    color: var(--text);
  }
  .card-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
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
  .card-btn.danger {
    color: var(--danger);
  }
  .held {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .held p {
    margin: 0 0 8px;
  }
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
  .shown-key {
    padding-bottom: 12px;
  }
  .devices {
    padding: 12px 0 0;
    border-top: 1px solid var(--border);
  }
  .devices-label {
    font-size: 13px;
    color: var(--text);
  }
  .devices ul {
    margin: 6px 0 12px;
    padding: 0;
    list-style: none;
  }
  .device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
  }
  .device + .device {
    border-top: 1px solid var(--border);
  }
  .device-name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    color: var(--text);
  }
  .device-meta {
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
</style>
