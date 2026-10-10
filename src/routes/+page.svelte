<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { save } from "@tauri-apps/plugin-dialog";
  import { exportNoteFile, quitApp, sheetCsv } from "$lib/api/client";
  import { EVENTS } from "$lib/api/events";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import NoteList from "$lib/components/NoteList.svelte";
  import UpdateNote from "$lib/components/UpdateNote.svelte";
  import BulkActions from "$lib/components/BulkActions.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import AgentNote from "$lib/components/AgentNote.svelte";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { isAgentNoteId, isAgentsSpaceId } from "$lib/agents/space";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { imagePrefs } from "$lib/stores/images.svelte";
  import { sidebar } from "$lib/stores/sidebar.svelte";
  import { linkPrefs as linkPrefsStore } from "$lib/stores/links.svelte";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { isWhiteboardTarget } from "$lib/whiteboard/keys";
  import { excalidrawFile, parseBoard } from "$lib/whiteboard/document";
  import { updateSpace } from "$lib/stores/update-space";
  import { licenseSpace } from "$lib/stores/license-space.svelte";
  import LicenseNote from "$lib/components/LicenseNote.svelte";
  import { isMac } from "$lib/platform";
  import {
    isUpdateNoteId,
    isUpdateSpaceId,
    isVirtualNoteId,
    UPDATE_SPACE_ID,
  } from "$lib/update/space";

  let appVersion = $state("");
  let paletteOpen = $state(false);
  let settingsOpen = $state(false);

  $effect(() => {
    if (updateSpace.visible) return;
    if (
      isUpdateSpaceId(library.activeWorkspaceId) ||
      isVirtualNoteId(library.selected?.id)
    ) {
      library.selectWorkspace(null);
    }
  });

  agents.show = () => {
    if (licenseSpace.locked) return;
    settingsOpen = false;
    agentsSpace.open();
  };
  $effect(() => {
    agents.setWatching(!settingsOpen && isAgentsSpaceId(library.activeWorkspaceId));
  });

  function openUpdate() {
    settingsOpen = false;
    library.selectWorkspace(UPDATE_SPACE_ID);
    const lead = updateSpace.leadNote;
    if (lead) library.selectVirtual(lead);
  }

  onMount(() => {
    if (isMac) document.documentElement.dataset.chrome = "overlay";
    void library.init();
    void editorPrefs.init();
    void imagePrefs.init();
    void sidebar.init();
    void linkPrefsStore.init();
    void contexting.init();
    void agents.init();
    const warmEditor = setTimeout(() => void import("$lib/components/NoteEditor.svelte"), 800);
    const warmViews = setTimeout(() => {
      void import("$lib/components/SettingsView.svelte");
      void import("$lib/components/GraphView.svelte");
    }, 5000);
    void getVersion().then((v) => (appVersion = v));
    updater.start();
    let unlistenCheck: (() => void) | undefined;
    void listen(EVENTS.UPDATER_CHECK, async () => {
      await updater.checkNow({ manual: true });
      if (updater.pendingUpdate) openUpdate();
    }).then((un) => (unlistenCheck = un));

    let unlistenSettings: (() => void) | undefined;
    void listen(EVENTS.SETTINGS_OPEN, () => {
      if (licenseSpace.locked) return;
      settingsOpen = true;
    }).then((un) => (unlistenSettings = un));

    let unlistenNewNote: (() => void) | undefined;
    void listen(EVENTS.MENU_NEW_NOTE, () => {
      if (licenseSpace.locked) return;
      settingsOpen = false;
      void library.newNote();
    }).then((un) => (unlistenNewNote = un));

    let unlistenNewBoard: (() => void) | undefined;
    void listen(EVENTS.MENU_NEW_WHITEBOARD, () => {
      if (licenseSpace.locked) return;
      settingsOpen = false;
      void library.newWhiteboard();
    }).then((un) => (unlistenNewBoard = un));

    let unlistenNewSheet: (() => void) | undefined;
    void listen(EVENTS.MENU_NEW_SHEET, () => {
      if (licenseSpace.locked) return;
      settingsOpen = false;
      void library.newSheet();
    }).then((un) => (unlistenNewSheet = un));

    let unlistenExport: (() => void) | undefined;
    void listen(EVENTS.MENU_EXPORT_NOTE, () => {
      if (licenseSpace.locked) return;
      void exportSelectedNote();
    }).then((un) => (unlistenExport = un));

    let unlistenSticky: (() => void) | undefined;
    void listen(EVENTS.MENU_TOGGLE_STICKY, () => {
      if (licenseSpace.locked) return;
      void library.toggleSticky();
    }).then((un) => (unlistenSticky = un));

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
      unlistenCheck?.();
      unlistenSettings?.();
      unlistenNewNote?.();
      unlistenNewBoard?.();
      unlistenNewSheet?.();
      unlistenExport?.();
      unlistenSticky?.();
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
      paletteOpen = !paletteOpen;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (confirmDialog.request) return;
    if (licenseSpace.locked) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "k") {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
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
        if (!settingsOpen) library.clearMultiSelect();
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

  async function exportSelectedNote() {
    const note = library.selected;
    if (!note) return;
    await library.flushPendingEdits();
    const filename = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-");
    const board = note.contentKind === "whiteboard";
    const sheet = note.contentKind === "sheet";
    const [ext, filter] = board
      ? ["excalidraw", { name: "Excalidraw", extensions: ["excalidraw"] }]
      : sheet
        ? ["csv", { name: "CSV", extensions: ["csv"] }]
        : ["md", { name: "Markdown", extensions: ["md"] }];
    const path = await save({ defaultPath: `${filename}.${ext}`, filters: [filter] });
    if (!path) return;
    const contents = board
      ? excalidrawFile(parseBoard(note.surfaceData))
      : sheet
        ? await sheetCsv(note.id)
        : note.body;
    await exportNoteFile(path, contents);
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

{#if settingsOpen && !licenseSpace.locked}
  {#await import("$lib/components/SettingsView.svelte") then { default: SettingsView }}
    <SettingsView
      {appVersion}
      onBack={() => (settingsOpen = false)}
      onShowSpace={(id) => {
        if (isAgentsSpaceId(id)) agentsSpace.open();
        else library.selectWorkspace(id);
        settingsOpen = false;
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
        {#if !licenseSpace.locked && library.multiSelected.size <= 1 && library.selected && !isUpdateNoteId(library.selected.id) && !isAgentNoteId(library.selected.id)}
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

<CommandPalette bind:open={paletteOpen} />
<ConfirmDialog />
<Toast />

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
