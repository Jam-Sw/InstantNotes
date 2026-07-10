<script lang="ts">
  // Library window composition root: lays out the three panes and owns the
  // app-chrome state (command palette, update panel) plus the global keyboard
  // shortcuts. Each pane lives in its own component under $lib/components.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { save } from "@tauri-apps/plugin-dialog";
  import { exportNoteFile, quitApp } from "$lib/api/client";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import NoteList from "$lib/components/NoteList.svelte";
  import NoteEditor from "$lib/components/NoteEditor.svelte";
  import BulkActions from "$lib/components/BulkActions.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import UpdatePanel from "$lib/components/UpdatePanel.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";

  let appVersion = $state("");
  let paletteOpen = $state(false);
  let updatePanelOpen = $state(false);
  let settingsOpen = $state(false);

  onMount(() => {
    void library.init();
    void editorPrefs.init();
    void contexting.init();
    void getVersion().then((v) => (appVersion = v));
    updater.start();
    // Tray "Check for Updates…" opens the panel and runs a manual check.
    let unlistenCheck: (() => void) | undefined;
    void listen("updater:check", () => {
      updatePanelOpen = true;
      void updater.checkNow({ manual: true });
    }).then((un) => (unlistenCheck = un));

    // Menu bar events.
    let unlistenSettings: (() => void) | undefined;
    void listen("settings:open", () => {
      settingsOpen = true;
    }).then((un) => (unlistenSettings = un));

    let unlistenNewNote: (() => void) | undefined;
    void listen("menu:new-note", () => {
      settingsOpen = false;
      void library.newNote();
    }).then((un) => (unlistenNewNote = un));

    let unlistenExport: (() => void) | undefined;
    void listen("menu:export-note", () => {
      void exportSelectedNote();
    }).then((un) => (unlistenExport = un));

    // Quit handshake: persist the debounced edit, then tell Rust to exit for
    // real. If this webview is hung the Rust-side fallback exits anyway.
    let unlistenQuit: (() => void) | undefined;
    void listen("app:quit-requested", async () => {
      await library.flushPendingEdits();
      await quitApp();
    }).then((un) => (unlistenQuit = un));

    const flush = () => void library.flushPendingEdits();
    window.addEventListener("blur", flush);
    window.addEventListener("keydown", onKeydown);
    return () => {
      updater.stop();
      unlistenCheck?.();
      unlistenSettings?.();
      unlistenNewNote?.();
      unlistenExport?.();
      unlistenQuit?.();
      window.removeEventListener("blur", flush);
      window.removeEventListener("keydown", onKeydown);
    };
  });

  function isTypingTarget(t: EventTarget | null): t is HTMLElement {
    return (
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    );
  }

  function onKeydown(e: KeyboardEvent) {
    // The confirm dialog stops propagation itself, but that only covers keys
    // dispatched through it; this guard catches the rest (focus on body after
    // an invoker unmounted) so nothing moves under an open modal.
    if (confirmDialog.request) return;
    const mod = e.metaKey || e.ctrlKey;
    // ⌘K toggles the command palette from anywhere, including input fields.
    if (mod && e.key === "k") {
      e.preventDefault();
      paletteOpen = !paletteOpen;
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
    const path = await save({
      defaultPath: `${filename}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    await exportNoteFile(path, note.body);
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

{#if settingsOpen}
  <SettingsView {appVersion} onBack={() => (settingsOpen = false)} />
{:else}
  <div class="layout">
    <Sidebar />
    <NoteList />
    <section class="editor-pane">
      {#if library.multiSelected.size > 1}
        <BulkActions />
      {:else if library.selected}
        <NoteEditor />
      {:else}
        <WelcomeScreen {appVersion} onShowUpdate={() => (updatePanelOpen = true)} />
      {/if}
    </section>
  </div>
{/if}

<CommandPalette bind:open={paletteOpen} />
<UpdatePanel bind:open={updatePanelOpen} currentVersion={appVersion} />
<ConfirmDialog />
<Toast />

<style>
  .layout {
    display: grid;
    grid-template-columns: 190px 280px 1fr;
    /* Pin the single row to the viewport so each pane scrolls internally
       instead of growing the row and clipping content below the fold. */
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
  }

  .editor-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
