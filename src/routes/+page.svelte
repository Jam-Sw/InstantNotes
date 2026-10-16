<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "$lib/components/Icon.svelte";
  import { LIST_PANE, NAV_PANE, layout, layoutShortcut } from "$lib/stores/layout.svelte";
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
  import { isMac, modKey, shiftKey } from "$lib/platform";
  import { startDiagnostics } from "$lib/stores/diagnostics";
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

  layout.onLeave = () => library.clearMultiSelect();

  const selectedId = $derived(library.selected?.id ?? null);
  $effect(() => {
    void layout.mode;
    const open = selectedId !== null;
    untrack(() => (open ? layout.showNote() : layout.showList()));
  });

  $effect(() => {
    const widthClass = layout.widthClass;
    const width = layout.width;
    untrack(() => sidebar.setViewport(widthClass, width, selectedId !== null));
  });
  $effect(() => {
    if (selectedId !== null) untrack(() => sidebar.noteOpened());
  });
  $effect(() => {
    if (library.searchText.trim() && !layout.phone) untrack(() => sidebar.revealList());
  });

  const view = $derived(
    `${library.graphMode}|${library.revisitMode}|${library.activeTagId}|${library.activeWorkspaceId}|${shell.settingsOpen}`,
  );
  let lastView: string | undefined;
  $effect(() => {
    const now = view;
    untrack(() => {
      sidebar.narrowOpen = false;
      if (lastView !== undefined && lastView !== now && sidebar.listOverlay) sidebar.revealList();
      lastView = now;
    });
  });

  const drawer = $derived(sidebar.narrow);
  const onePane = $derived(layout.phone && !library.graphMode);
  const showList = $derived(!onePane || layout.pane === "list");
  const showEditor = $derived(!onePane || layout.pane === "note");
  const backButton = $derived(onePane && layout.pane === "note");
  const listOverlay = $derived(sidebar.listOverlay);
  const listHidden = $derived(sidebar.listHidden);
  const navTrack = $derived(sidebar.navTrack);
  const listTrack = $derived(library.graphMode ? 0 : sidebar.listTrack);
  const columns = $derived(
    layout.phone ? "minmax(0, 1fr)" : `${navTrack}px ${listTrack}px minmax(0, 1fr)`,
  );
  const listToggleShown = $derived(!layout.phone && !library.graphMode);
  const editorEdge = $derived(listToggleShown && !sidebar.navInline && !sidebar.listInline);
  const listX = $derived(navTrack + listTrack);
  let animate = $state(false);
  let dragging = $state<"nav" | "list" | null>(null);

  const reducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = (ms: number) => (reducedMotion() ? 0 : ms);

  function onListClick(e: MouseEvent) {
    if (!listOverlay || e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (e.target instanceof Element && e.target.closest(".note-row")) sidebar.closeList();
  }

  function openUpdate() {
    shell.closeSettings();
    library.selectWorkspace(UPDATE_SPACE_ID);
    const lead = updateSpace.leadNote;
    if (lead) library.selectVirtual(lead);
  }
  updater.show = openUpdate;

  onMount(() => {
    if (isMac && !isWeb) document.documentElement.dataset.chrome = "overlay";
    void library.init().then(() => library.openLinked(location.hash));
    void editorPrefs.init();
    void imagePrefs.init();
    void sidebar.init().then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => (animate = true)));
    });
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
    const stopDiagnostics = startDiagnostics();
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
    const stopLayout = layout.init();
    return () => {
      stopLayout();
      clearTimeout(warmEditor);
      clearTimeout(warmViews);
      updater.stop();
      stopDiagnostics();
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
    const toggled = layoutShortcut(e, isMac);
    if (toggled) {
      e.preventDefault();
      if (toggled === "nav") sidebar.toggle();
      else sidebar.toggleList();
      return;
    }
    if (isWhiteboardTarget(e.target)) return;
    if (
      e.key === "Escape" &&
      !shell.paletteOpen &&
      !(e.target instanceof HTMLInputElement && e.target.type === "search" && e.target.value) &&
      sidebar.closeOverlay()
    ) {
      e.preventDefault();
      return;
    }
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
        if (backButton) layout.back();
        else if (!shell.settingsOpen) library.clearMultiSelect();
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

  function startDrag(e: PointerEvent, pane: "nav" | "list") {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    dragging = pane;
    const startX = e.clientX;
    const startWidth = pane === "nav" ? sidebar.navWidth : sidebar.listWidth;
    const move = (ev: PointerEvent) => {
      const raw = startWidth + ev.clientX - startX;
      if (pane === "nav") sidebar.resizeNav(raw);
      else sidebar.resizeList(raw);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      dragging = null;
      sidebar.commitDrag(pane);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function onHandleKeydown(e: KeyboardEvent, pane: "nav" | "list") {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      sidebar.stepPane(pane, e.key === "ArrowLeft" ? -1 : 1);
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
    class:phone={layout.phone}
    class:animate
    class:resizing={dragging !== null}
    data-nav={drawer ? "" : undefined}
    data-list-overlay={listOverlay ? "" : undefined}
    data-edge={editorEdge ? "" : undefined}
    style:--list-x="{listX}px"
    style:--nav-w="{sidebar.navWidth}px"
    style:--list-w="{sidebar.listWidth}px"
    style:grid-template-columns={columns}
  >
    {#if layout.widthClass === "large" || layout.widthClass === "expanded"}
      <div class="nav-slot" class:hidden={!sidebar.navInline} inert={!sidebar.navInline}>
        <Sidebar />
      </div>
    {/if}
    {#if library.graphMode && !licenseSpace.locked}
      <section class="graph-span">
        {#await import("$lib/components/GraphView.svelte") then { default: GraphView }}
          <GraphView />
        {/await}
      </section>
    {:else}
      {#if showList}
        <div
          class="list-slot"
          class:hidden={listHidden}
          inert={listHidden}
          role="presentation"
          onclick={onListClick}
        >
          <NoteList />
        </div>
      {/if}
      {#if showEditor}
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
    {/if}
    {#if sidebar.navInline}
      <div
        class="divider"
        class:dragging={dragging === "nav"}
        class:snapping={sidebar.snapping === "nav"}
        style:left="{navTrack - 5}px"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={sidebar.navWidth}
        aria-valuemin={NAV_PANE.min}
        aria-valuemax={NAV_PANE.max}
        tabindex="0"
        onpointerdown={(e) => startDrag(e, "nav")}
        ondblclick={() => sidebar.resetWidth("nav")}
        onkeydown={(e) => onHandleKeydown(e, "nav")}
      ></div>
    {/if}
    {#if sidebar.listInline && !library.graphMode && showList}
      <div
        class="divider"
        class:dragging={dragging === "list"}
        class:snapping={sidebar.snapping === "list"}
        style:left="{listX - 5}px"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize note list"
        aria-valuenow={sidebar.listWidth}
        aria-valuemin={LIST_PANE.min}
        aria-valuemax={LIST_PANE.max}
        tabindex="0"
        onpointerdown={(e) => startDrag(e, "list")}
        ondblclick={() => sidebar.resetWidth("list")}
        onkeydown={(e) => onHandleKeydown(e, "list")}
      ></div>
    {/if}
    {#if listToggleShown}
      <button
        class="pane-nav list-toggle"
        aria-label="Toggle note list"
        aria-expanded={!listHidden}
        title={`${listHidden ? "Show" : "Hide"} Note List (${modKey}${shiftKey}L)`}
        onclick={() => sidebar.toggleList()}
      >
        <Icon name="list" size={20} />
      </button>
    {/if}
    {#if listOverlay && showList && sidebar.listOpen && !library.graphMode}
      <div
        class="drawer-scrim list-scrim"
        role="presentation"
        transition:fade={{ duration: motion(160) }}
        onclick={() => sidebar.closeList()}
      ></div>
    {/if}
    {#if drawer}
      {#if backButton}
        <button class="pane-nav" aria-label="Back to the notes" onclick={() => layout.back()}>
          <Icon name="back" size={20} />
        </button>
      {:else}
        <button
          class="pane-nav"
          aria-label="Show the sidebar"
          aria-expanded={sidebar.narrowOpen}
          onclick={() => sidebar.toggle()}
        >
          <Icon name="menu" size={20} />
        </button>
      {/if}
      {#if sidebar.narrowOpen}
        <div
          class="drawer-scrim"
          role="presentation"
          transition:fade={{ duration: motion(160) }}
          onclick={() => (sidebar.narrowOpen = false)}
        ></div>
        <div class="drawer" transition:fly={{ x: -300, duration: motion(220), opacity: 1, easing: cubicOut }}>
          <Sidebar />
          <button class="drawer-settings" onclick={() => shell.openSettings()}>Settings</button>
        </div>
      {/if}
    {/if}
  </div>
{/if}

{#if layout.touch && !shell.paletteOpen && !sidebar.narrowOpen && !licenseSpace.locked}
  <button class="palette-fab" aria-label="Commands" onclick={() => shell.togglePalette()}>
    <Icon name="command" size={22} />
  </button>
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
    --pane-ms: 220ms;
    --pane-ease: cubic-bezier(0, 0, 0.2, 1);
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    height: var(--app-height, 100dvh);
    overflow: hidden;
    position: relative;
  }
  .layout.animate:not(.resizing) {
    transition: grid-template-columns var(--pane-ms) var(--pane-ease);
  }

  /* The dividers draw the line between panes, so the panes drop their own. */
  .layout :global(.list-pane),
  .layout :global(.sidebar) {
    border-right: none;
  }

  .nav-slot,
  .list-slot {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    transition: visibility 0s linear var(--pane-ms);
  }
  .nav-slot {
    grid-column: 1;
  }
  .nav-slot > :global(.sidebar) {
    flex: none;
    width: var(--nav-w);
  }
  .list-slot {
    grid-column: 2;
  }
  .list-slot > :global(.list-pane) {
    flex: none;
    width: var(--list-w);
  }
  .nav-slot.hidden,
  .list-slot.hidden {
    visibility: hidden;
  }
  .layout.phone > .list-slot {
    display: contents;
  }
  .layout.phone > .nav-slot,
  .layout.phone > .editor-pane,
  .layout.phone > .graph-span {
    grid-column: auto;
  }
  .layout[data-list-overlay] > .list-slot {
    grid-column: auto;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 29;
    width: min(320px, 84vw);
    overflow: visible;
    box-shadow: var(--shadow-lg);
    transform: translateX(-100%);
    transition:
      transform var(--pane-ms) var(--pane-ease),
      visibility 0s linear var(--pane-ms);
  }
  .layout[data-list-overlay] > .list-slot:not(.hidden) {
    transform: none;
    transition: transform var(--pane-ms) var(--pane-ease);
  }
  .layout[data-list-overlay] > .list-slot > :global(.list-pane) {
    flex: 1;
    width: auto;
    padding-left: env(safe-area-inset-left);
  }
  .list-scrim {
    z-index: 28;
  }

  /* With the nav in its drawer, the menu button covers the left edge of the first pane. */
  .layout[data-nav] > .list-slot :global(.pane-header),
  .layout[data-nav] > .graph-span :global(.pane-header),
  .layout[data-nav].phone > .editor-pane :global(.pane-header) {
    padding-left: calc(max(12px, var(--chrome-inset)) + 40px);
  }
  .layout[data-list-overlay] > .list-slot :global(.pane-header) {
    padding-left: 12px;
  }

  .layout:not(.phone) > .editor-pane > :global(.pane-header) {
    padding-left: 46px;
  }
  .layout[data-edge][data-nav] > .editor-pane > :global(.pane-header) {
    padding-left: calc(max(6px, var(--chrome-inset)) + env(safe-area-inset-left) + 80px);
  }

  .pane-nav {
    position: absolute;
    top: calc(env(safe-area-inset-top) + (var(--chrome-h) - 36px) / 2);
    left: calc(max(6px, var(--chrome-inset)) + env(safe-area-inset-left));
    z-index: 20;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pane-nav:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .list-toggle {
    left: calc(var(--list-x) + 6px);
  }
  .layout.animate:not(.resizing) .list-toggle {
    transition: left var(--pane-ms) var(--pane-ease);
  }
  .layout[data-edge] .list-toggle {
    left: calc(max(6px, var(--chrome-inset)) + env(safe-area-inset-left));
  }
  .layout[data-edge][data-nav] .list-toggle {
    left: calc(max(6px, var(--chrome-inset)) + env(safe-area-inset-left) + 40px);
  }

  .drawer-scrim {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: rgba(0, 0, 0, 0.32);
  }
  .drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 31;
    display: flex;
    flex-direction: column;
    width: min(300px, 84vw);
    background: var(--bg-sidebar);
    box-shadow: var(--shadow-lg);
  }
  .drawer > :global(.sidebar) {
    flex: 1;
    min-height: 0;
    padding-left: env(safe-area-inset-left);
    border-right: none;
  }
  .drawer-settings {
    flex: none;
    min-height: 44px;
    margin: 0 10px calc(10px + env(safe-area-inset-bottom));
    padding: 0 10px;
    border-top: 1px solid var(--divider);
    text-align: left;
    color: var(--text);
  }

  .palette-fab {
    position: fixed;
    right: calc(16px + env(safe-area-inset-right));
    bottom: calc(44px + env(safe-area-inset-bottom));
    z-index: 90;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--bg-sidebar);
    color: var(--accent-text);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
  }
  .palette-fab:active {
    transform: scale(0.94);
  }

  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 10;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }
  .divider::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: var(--divider);
  }
  .divider:hover::after,
  .divider.dragging::after,
  .divider:focus-visible::after {
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-soft);
  }
  .divider.snapping::after {
    background: var(--danger);
  }

  .editor-pane {
    grid-column: 3;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .graph-span {
    grid-column: 2 / 4;
    min-width: 0;
    min-height: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .layout.animate:not(.resizing),
    .layout.animate:not(.resizing) .list-toggle,
    .nav-slot,
    .list-slot,
    .layout[data-list-overlay] > .list-slot,
    .layout[data-list-overlay] > .list-slot:not(.hidden) {
      transition: none;
    }
  }
</style>
