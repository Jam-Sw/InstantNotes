<script lang="ts">
  import { onMount } from "svelte";
  import { getSetting, setCaptureShortcut, setSetting } from "$lib/api/client";
  import { isWeb } from "$lib/api/runtime";
  import { confirmDialog, CONFIRM_DEFAULTS, type ConfirmLevel } from "$lib/stores/confirm.svelte";
  import { layout, LAYOUT_DEFAULTS, type PaneMax } from "$lib/stores/layout.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { captureKeys } from "$lib/stores/capture-keys.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { updater, UPDATER_DEFAULTS, type CheckInterval } from "$lib/stores/updater.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  const KEY_CAPTURE = "shortcuts.capture";
  const KEY_TRAY = "window.closeToTray";
  const DEFAULTS = { shortcut: "", closeToTray: !import.meta.env.DEV };

  const INTERVAL_OPTIONS: { value: CheckInterval; label: string }[] = [
    { value: "startup", label: "Startup" },
    { value: "6h", label: "6 hours" },
    { value: "daily", label: "Daily" },
    { value: "never", label: "Never" },
  ];

  const CONFIRM_OPTIONS: { value: ConfirmLevel; label: string }[] = [
    { value: "always", label: "Always" },
    { value: "permanent", label: "Permanent only" },
  ];

  const PANE_OPTIONS: { value: PaneMax; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "wide", label: "Wide" },
  ];

  let shortcut = $state(DEFAULTS.shortcut);
  let savedShortcut = DEFAULTS.shortcut;
  let closeToTray = $state(DEFAULTS.closeToTray);
  let shortcutTouched = false;
  let trayTouched = false;

  const errorMessage = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

  onMount(() => {
    void confirmDialog.init();
    if (isWeb) return;
    void getSetting<string>(KEY_CAPTURE)
      .then((v) => {
        if (typeof v === "string" && !shortcutTouched) shortcut = savedShortcut = v;
      })
      .catch(() => {});
    void getSetting<boolean>(KEY_TRAY)
      .then((v) => {
        if (typeof v === "boolean" && !trayTouched) closeToTray = v;
      })
      .catch(() => {});
  });

  let pending = Promise.resolve();

  function commitShortcut() {
    shortcutTouched = true;
    const next = shortcut.trim();
    shortcut = next;
    pending = pending.then(async () => {
      if (next === savedShortcut) return;
      try {
        await setCaptureShortcut(next);
        savedShortcut = next;
        captureKeys.custom = next;
      } catch (e) {
        toasts.show(`Couldn't set shortcut: ${errorMessage(e)}`);
        shortcut = savedShortcut;
      }
    });
    return pending;
  }

  function setTray(on: boolean) {
    trayTouched = true;
    closeToTray = on;
    void setSetting(KEY_TRAY, on).catch(() => toasts.show("Couldn't save setting"));
  }

  function setPaneMax(v: PaneMax) {
    layout.setPaneMax(v);
    sidebar.refitPanes();
  }
</script>

<div class="behavior-pane-settings">
  <h2>Behavior</h2>

  {#if !isWeb}
    <PrefRow
      label="Capture shortcut"
      reset={shortcut !== DEFAULTS.shortcut
        ? () => {
            shortcut = DEFAULTS.shortcut;
            void commitShortcut();
          }
        : undefined}
    >
      {#snippet control()}
        <input
          class="shortcut-input"
          type="text"
          bind:value={shortcut}
          placeholder="Default"
          spellcheck="false"
          aria-label="Capture shortcut"
          onchange={() => void commitShortcut()}
        />
      {/snippet}
    </PrefRow>
    <ToggleRow
      label="Close to tray"
      checked={closeToTray}
      reset={closeToTray !== DEFAULTS.closeToTray ? () => setTray(DEFAULTS.closeToTray) : undefined}
      onchange={setTray}
    />
  {/if}

  <details class="more">
    <summary>More</summary>
    {#if !isWeb}
      <SegmentedRow
        label="Check for updates"
        options={INTERVAL_OPTIONS}
        value={updater.checkInterval}
        reset={updater.checkInterval !== UPDATER_DEFAULTS.checkInterval
          ? () => updater.setCheckInterval(UPDATER_DEFAULTS.checkInterval)
          : undefined}
        onchange={(v) => updater.setCheckInterval(v)}
      />
    {/if}
    <SegmentedRow
      label="Confirm before"
      options={CONFIRM_OPTIONS}
      value={confirmDialog.level}
      reset={confirmDialog.level !== CONFIRM_DEFAULTS.level
        ? () => confirmDialog.setLevel(CONFIRM_DEFAULTS.level)
        : undefined}
      onchange={(v) => confirmDialog.setLevel(v)}
    />
    {#if !isWeb}
      <SegmentedRow
        label="Pane width limit"
        options={PANE_OPTIONS}
        value={layout.paneMax}
        reset={layout.paneMax !== LAYOUT_DEFAULTS.paneMax ? () => setPaneMax(LAYOUT_DEFAULTS.paneMax) : undefined}
        onchange={setPaneMax}
      />
    {/if}
  </details>
</div>

<style>
  .behavior-pane-settings {
    max-width: 560px;
  }
  .behavior-pane-settings h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .shortcut-input {
    width: 180px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 13px;
  }
  .shortcut-input:focus {
    outline: 2px solid var(--accent-soft);
    border-color: var(--accent);
  }
</style>
