<script lang="ts">
  import { onMount } from "svelte";
  import { appVersion as fetchAppVersion, getSyncServerStatus, quitApp } from "$lib/api/client";
  import type { SyncStage } from "$lib/api/types";
  import { EVENTS, listen } from "$lib/api/events";
  import { isWeb } from "$lib/api/runtime";
  import { runCommand } from "$lib/commands";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import NoteList from "$lib/components/NoteList.svelte";
  import UpdateNote from "$lib/components/UpdateNote.svelte";
  import BulkActions from "$lib/components/BulkActions.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import OpenElsewhere from "$lib/components/OpenElsewhere.svelte";
  import SyncJoinDialog from "$lib/components/SyncJoinDialog.svelte";
  import OtherTabScreen from "$lib/components/OtherTabScreen.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import AgentNote from "$lib/components/AgentNote.svelte";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { isAgentNoteId, isAgentsSpaceId } from "$lib/agents/space";
  import { mergeSpace } from "$lib/stores/merge-space.svelte";
  import { isMergeNoteId, isMergeSpaceId } from "$lib/merge/space";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { imagePrefs } from "$lib/stores/images.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { linkPrefs as linkPrefsStore } from "$lib/stores/links.svelte";
  import { theme } from "$lib/stores/theme.svelte";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { shell } from "$lib/stores/shell.svelte";
  import { isWhiteboardTarget } from "$lib/whiteboard/keys";
  import { updateSpace } from "$lib/stores/update-space";
  import { licenseSpace } from "$lib/stores/license-space.svelte";
  import { agreements } from "$lib/agreements.svelte";
  import LicenseNote from "$lib/components/LicenseNote.svelte";
  import { isMac } from "$lib/platform";
  import {
    isUpdateNoteId,
    isUpdateSpaceId,
    isVirtualNoteId,
    UPDATE_SPACE_ID,
  } from "$lib/update/space";

  let appVersion = $state("");
  const SYNC_NEEDS_YOU = new Set<SyncStage>([
    "off",
    "needsKey",
    "recoveryKey",
    "confirmPlain",
    "otherLibrary",
  ]);

  $effect(() => {
    if (updateSpace.visible) return;
    if (
      isUpdateSpaceId(library.activeWorkspaceId) ||
      isVirtualNoteId(library.selected?.id)
    ) {
      library.selectWorkspace(null);
    }
  });

  function checkSync() {
    void getSyncServerStatus()
      .then((status) => {
        if (!SYNC_NEEDS_YOU.has(status.stage) || shell.settingsOpen || licenseSpace.locked) return;
        shell.openSettings("vault");
      })
      .catch(() => {});
  }

  $effect(() => {
    if (isWeb && !licenseSpace.locked) checkSync();
  });

  $effect(() => {
    if (mergeSpace.visible) return;
    if (isMergeSpaceId(library.activeWorkspaceId) || isMergeNoteId(library.selected?.id)) {
      library.selectWorkspace(null);
    }
  });

  agents.show = () => {
    if (licenseSpace.locked) return;
    shell.closeSettings();
    agentsSpace.open();
  };
  $effect(() => {
    agents.setWatching(!shell.settingsOpen && isAgentsSpaceId(library.activeWorkspaceId));
  });

  function openUpdate() {
    shell.closeSettings();
    library.selectWorkspace(UPDATE_SPACE_ID);
    const lead = updateSpace.leadNote;
    if (lead) library.selectVirtual(lead);
  }
  updater.show = openUpdate;

  onMount(() => {
    if (isMac) document.documentElement.dataset.chrome = "overlay";
    void library.init().then(() => library.openLinked(location.hash));
    void editorPrefs.init();
    void imagePrefs.init();
    void sidebar.init();
    void linkPrefsStore.init();
    void contexting.init();
    void agents.init();
    void mergeSpace.init();
    const warmEditor = setTimeout(() => void import("$lib/components/NoteEditor.svelte"), 800);
    const warmViews = setTimeout(() => {
      void import("$lib/components/SettingsView.svelte");
      void import("$lib/components/GraphView.svelte");
    }, 5000);
    void fetchAppVersion().then((v) => (appVersion = v));
    void agreements.init();
    updater.start();
    let unlistenCommand: (() => void) | undefined;
    void listen<{ id: string }>(EVENTS.MENU_COMMAND, (e) => void runCommand(e.payload.id)).then(
      (un) => (unlistenCommand = un),
    );

    let unlistenSettings: (() => void) | undefined;
    void listen(EVENTS.SETTINGS_CHANGED, () => {
      void theme.init();
      void editorPrefs.reload();
      void imagePrefs.reload();
      void linkPrefsStore.reload();
    }).then((un) => (unlistenSettings = un));

    let unlistenSyncNeeds: (() => void) | undefined;
    if (isWeb) {
      void listen(EVENTS.VAULT_STATUS, checkSync).then((un) => (unlistenSyncNeeds = un));
    }

    let unlistenQuit: (() => void) | undefined;
    void listen(EVENTS.APP_QUIT_REQUESTED, async () => {
      await library.flushPendingEdits();
      await quitApp();
    }).then((un) => (unlistenQuit = un));

    const flush = () => void library.flushPendingEdits();
    window.addEventListener("blur", flush);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keydown", onBoardPaletteKey, true);
    const narrow = window.matchMedia("(max-width: 960px)");
    const onNarrow = () => sidebar.setNarrow(narrow.matches);
    onNarrow();
    narrow.addEventListener("change", onNarrow);
    return () => {
      narrow.removeEventListener("change", onNarrow);
      clearTimeout(warmEditor);
      clearTimeout(warmViews);
      updater.stop();
      unlistenCommand?.();
      unlistenSettings?.();
      unlistenSyncNeeds?.();
      unlistenQuit?.();
      window.removeEventListener("blur", flush);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("keydown", onBoardPaletteKey, true);
    };
  });

  function isTypingTarget(t: EventTarget | null): t is HTMLElement {
    return (
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable ||
        t.closest("[data-sheet]") !== null)
    );
  }

  function onBoardPaletteKey(e: KeyboardEvent) {
    if (licenseSpace.locked) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "k" && isWhiteboardTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      shell.togglePalette();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (confirmDialog.request) return;
    if (licenseSpace.locked) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "k") {
      e.preventDefault();
      shell.togglePalette();
      return;
    }
    if (isWeb && mod && e.key === ",") {
      e.preventDefault();
      shell.openSettings();
      return;
    }
    if (!isWeb && mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      if (agents.watching) library.selectWorkspace(null);
      else agents.show();
      return;
    }
    if (mod && e.key === "\\") {
      e.preventDefault();
      sidebar.toggle();
      return;
    }
    if (isWhiteboardTarget(e.target)) return;
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      editorPrefs.zoomIn();
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      editorPrefs.zoomOut();
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      editorPrefs.resetZoom();
      return;
    }
    if (isTypingTarget(e.target)) {
      if (
        e.key === "Escape" &&
        e.target instanceof HTMLInputElement &&
        e.target.type === "search"
      ) {
        library.setSearch("");
        e.target.blur();
      }
      return;
    }
    if (library.graphMode) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        void moveAndReveal(1, e.shiftKey);
        break;
      case "ArrowUp":
        e.preventDefault();
        void moveAndReveal(-1, e.shiftKey);
        break;
      case "a":
        if (mod) {
          e.preventDefault();
          void library.selectAllVisible();
        }
        break;
      case "Backspace":
        if (mod && library.multiSelected.size > 0) {
          e.preventDefault();
          void deleteSelection();
        }
        break;
      case "Escape":
        if (!shell.settingsOpen) library.clearMultiSelect();
        break;
    }
  }

  async function moveAndReveal(delta: number, extend: boolean) {
    const id = await library.moveSelection(delta, extend);
    if (!id) return;
    document
      .querySelector(`.note-row[data-note-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  async function deleteSelection() {
    if (library.statusFilter === "trash") {
      await confirmBulkDestroy();
    } else {
      await library.bulkDelete();
    }
  }

  let draggingSidebar = $state(false);

  function startSidebarDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    draggingSidebar = true;
    const startX = e.clientX;
    const startWidth = sidebar.width;
    const move = (ev: PointerEvent) => sidebar.setWidth(startWidth + ev.clientX - startX);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      draggingSidebar = false;
      sidebar.commitWidth();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  function onHandleKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      sidebar.setWidth(sidebar.width + (e.key === "ArrowLeft" ? -10 : 10));
      sidebar.commitWidth();
    }
  }

  async function confirmBulkDestroy() {
    const ids = [...library.multiSelected];
    if (ids.length === 0) return;
    const what = ids.length === 1 ? "this note" : `these ${ids.length} notes`;
    const ok = await confirmDialog.ask({
      title: `Delete ${what} permanently?`,
      body: "This action cannot be undone.",
      confirmLabel: "Delete Forever",
      tone: "danger",
    });
    if (ok) await library.destroyNotes(ids);
  }
</script>

{#if shell.settingsOpen && !licenseSpace.locked}
  {#await import("$lib/components/SettingsView.svelte") then { default: SettingsView }}
    <SettingsView
      {appVersion}
      onBack={() => shell.closeSettings()}
      onShowSpace={(id) => {
        if (isAgentsSpaceId(id)) agentsSpace.open();
        else library.selectWorkspace(id);
        shell.closeSettings();
      }}
    />
  {/await}
{:else}
  <div
    class="layout"
    style:grid-template-columns={sidebar.hidden
      ? "280px 1fr"
      : `${sidebar.width}px 280px 1fr`}
  >
    {#if !sidebar.hidden}
      <Sidebar />
      <div
        class="sidebar-handle"
        class:dragging={draggingSidebar}
        style:left="{sidebar.width - 3}px"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={sidebar.width}
        tabindex="0"
        onpointerdown={startSidebarDrag}
        ondblclick={() => sidebar.resetWidth()}
        onkeydown={onHandleKeydown}
      ></div>
    {/if}
    {#if library.graphMode && !licenseSpace.locked}
      <section class="graph-span">
        {#await import("$lib/components/GraphView.svelte") then { default: GraphView }}
          <GraphView />
        {/await}
      </section>
    {:else}
      <NoteList />
      <section class="editor-pane">
        {#if !licenseSpace.locked && library.multiSelected.size <= 1 && library.selected && !isUpdateNoteId(library.selected.id) && !isAgentNoteId(library.selected.id) && !isMergeNoteId(library.selected.id)}
          {#await import("$lib/components/NoteEditor.svelte") then { default: NoteEditor }}
            <NoteEditor />
          {/await}
        {:else}
          <div class="pane-header" data-tauri-drag-region></div>
          {#if licenseSpace.locked}
            <LicenseNote />
          {:else if library.multiSelected.size > 1}
            <BulkActions />
          {:else if library.selected && isAgentNoteId(library.selected.id)}
            <AgentNote />
          {:else if library.selected && isMergeNoteId(library.selected.id)}
            {#await import("$lib/components/MergeNote.svelte") then { default: MergeNote }}
              <MergeNote />
            {/await}
          {:else if library.selected}
            <UpdateNote />
          {:else}
            <WelcomeScreen {appVersion} onOpenUpdate={openUpdate} />
          {/if}
        {/if}
      </section>
    {/if}
  </div>
{/if}

<CommandPalette bind:open={shell.paletteOpen} />
<ConfirmDialog />
<OpenElsewhere />
<SyncJoinDialog />
<Toast />
{#if isWeb}
  <OtherTabScreen />
{/if}

<style>
  .layout {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    position: relative;
  }

  .sidebar-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 10;
  }
  .sidebar-handle:hover,
  .sidebar-handle.dragging,
  .sidebar-handle:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }

  .editor-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .graph-span {
    grid-column: span 2;
    min-width: 0;
    min-height: 0;
  }
</style>
