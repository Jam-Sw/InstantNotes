<script lang="ts">
  // Library window composition root: lays out the three panes and owns the
  // app-chrome state (command palette, settings) plus the global keyboard
  // shortcuts. Each pane lives in its own component under $lib/components.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { save } from "@tauri-apps/plugin-dialog";
  import { exportNoteFile, quitApp } from "$lib/api/client";
  import { EVENTS } from "$lib/api/events";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import NoteList from "$lib/components/NoteList.svelte";
  import NoteEditor from "$lib/components/NoteEditor.svelte";
  import UpdateNote from "$lib/components/UpdateNote.svelte";
  import BulkActions from "$lib/components/BulkActions.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import GraphView from "$lib/components/GraphView.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import Toast from "$lib/components/Toast.svelte";
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
  import {
    isUpdateNoteId,
    isUpdateSpaceId,
    isVirtualNoteId,
    UPDATE_SPACE_ID,
  } from "$lib/update/space";

  let appVersion = $state("");
  let paletteOpen = $state(false);
  let settingsOpen = $state(false);

  // The update Space is synthetic: once the update is gone (installed and
  // answered, or no longer offered) there is no note behind it, so leave it
  // rather than render a pane pointing at something that does not exist.
  $effect(() => {
    if (updateSpace.visible) return;
    if (
      isUpdateSpaceId(library.activeWorkspaceId) ||
      isVirtualNoteId(library.selected?.id)
    ) {
      library.selectWorkspace(null);
    }
  });

  /** Take the welcome pill or a tray check into the update Space. */
  function openUpdate() {
    settingsOpen = false;
    library.selectWorkspace(UPDATE_SPACE_ID);
    const lead = updateSpace.leadNote;
    if (lead) library.selectVirtual(lead);
  }

  onMount(() => {
    void library.init();
    void editorPrefs.init();
    void imagePrefs.init();
    void sidebar.init();
    void linkPrefsStore.init();
    void contexting.init();
    void agents.init();
    void getVersion().then((v) => (appVersion = v));
    updater.start();
    // Tray "Check for Updates…": run a manual check, then show the update
    // Space if one turned up. The check itself toasts either outcome.
    let unlistenCheck: (() => void) | undefined;
    void listen(EVENTS.UPDATER_CHECK, async () => {
      await updater.checkNow({ manual: true });
      if (updater.pendingUpdate) openUpdate();
    }).then((un) => (unlistenCheck = un));

    // Menu bar events.
    let unlistenSettings: (() => void) | undefined;
    // The menu bar's entry points stand down until the license and EULA are
    // agreed (licenseSpace.locked), the same as the keyboard's.
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

    // Quit handshake: persist the debounced edit, then tell Rust to exit for
    // real. If this webview is hung the Rust-side fallback exits anyway.
    let unlistenQuit: (() => void) | undefined;
    void listen(EVENTS.APP_QUIT_REQUESTED, async () => {
      await library.flushPendingEdits();
      await quitApp();
    }).then((un) => (unlistenQuit = un));

    const flush = () => void library.flushPendingEdits();
    window.addEventListener("blur", flush);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("keydown", onBoardPaletteKey, true);
    return () => {
      updater.stop();
      unlistenCheck?.();
      unlistenSettings?.();
      unlistenNewNote?.();
      unlistenNewBoard?.();
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
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    );
  }

  // ⌘K on a board is still the palette. Excalidraw binds it to "add link"
  // and hears keys before the window does, so claim it on the way down;
  // stopping it here also keeps onKeydown from toggling the palette twice.
  function onBoardPaletteKey(e: KeyboardEvent) {
    if (licenseSpace.locked) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "k" && isWhiteboardTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      paletteOpen = !paletteOpen;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // The confirm dialog stops propagation itself, but that only covers keys
    // dispatched through it; this guard catches the rest (focus on body after
    // an invoker unmounted) so nothing moves under an open modal.
    if (confirmDialog.request) return;
    // Until the license and EULA are agreed, no shortcut does its work.
    if (licenseSpace.locked) return;
    const mod = e.metaKey || e.ctrlKey;
    // ⌘K toggles the command palette from anywhere, including input fields.
    if (mod && e.key === "k") {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    // ⌘\ toggles the sidebar from anywhere, including input fields and boards.
    if (mod && e.key === "\\") {
      e.preventDefault();
      sidebar.toggle();
      return;
    }
    // Every other key aimed at a whiteboard is the board's: arrows, ⌘A, and
    // ⌘= act on shapes there, not on the note list or the text zoom.
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
      // Escape in the search field clears the search; everything else is typing.
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
    // The note list is hidden behind the graph; its keys would act unseen.
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

  // Arrow-key navigation must keep the active row visible in the list.
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
    // A board exports as the drawing itself, openable in Excalidraw.
    const board = note.contentKind === "whiteboard";
    const path = await save({
      defaultPath: `${filename}.${board ? "excalidraw" : "md"}`,
      filters: board
        ? [{ name: "Excalidraw", extensions: ["excalidraw"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    // `note`, not library.selected: the selection can move while the dialog
    // is open, and the flush above already brought `note` up to date.
    await exportNoteFile(path, board ? excalidrawFile(parseBoard(note.surfaceData)) : note.body);
  }

  // Sidebar resize: pointer capture keeps the gesture on the handle even when
  // the pointer outruns it; width persists once at release, not per move.
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
    // Snapshot the ids when the dialog opens: the selection could otherwise
    // drift while it is up (menu events, cross-window refreshes) and the
    // confirm would destroy whatever is selected at resolve time instead.
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
  <SettingsView
    {appVersion}
    onBack={() => (settingsOpen = false)}
    onShowSpace={(id) => {
      library.selectWorkspace(id);
      settingsOpen = false;
    }}
  />
{:else}
  <div
    class="layout"
    style:grid-template-columns={sidebar.collapsed
      ? "280px 1fr"
      : `${sidebar.width}px 280px 1fr`}
  >
    {#if !sidebar.collapsed}
      <Sidebar />
      <!-- Sits on the sidebar/list border; drag resizes, double-click resets,
           arrows nudge. Collapse/expand lives on ⌘\ and the command palette.
           WAI-ARIA window-splitter: a focusable separator with arrow-key
           resizing is the canonical widget, which the a11y lint doesn't know. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
      <!-- The graph takes the list and editor columns together. -->
      <section class="graph-span">
        <GraphView />
      </section>
    {:else}
      <NoteList />
      <section class="editor-pane">
        {#if licenseSpace.locked}
          <LicenseNote />
        {:else if library.multiSelected.size > 1}
          <BulkActions />
        {:else if library.selected}
          {#if isUpdateNoteId(library.selected.id)}
            <UpdateNote />
          {:else}
            <NoteEditor />
          {/if}
        {:else}
          <WelcomeScreen {appVersion} onOpenUpdate={openUpdate} />
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
    /* Columns come from inline style: the sidebar column is drag-resizable
       and drops out entirely when collapsed (⌘\). */
    /* Pin the single row to the viewport so each pane scrolls internally
       instead of growing the row and clipping content below the fold. */
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    position: relative;
  }

  /* Invisible 6px hit strip straddling the sidebar border. The border itself
     stays the visual affordance; the strip only tints while engaged. */
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
  }
  .graph-span {
    grid-column: span 2;
    min-width: 0;
    min-height: 0;
  }
</style>
