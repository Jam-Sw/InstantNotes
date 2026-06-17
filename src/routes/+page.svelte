<script lang="ts">
  // Library window composition root: lays out the three panes and owns the
  // app-chrome state (command palette, update panel) plus the global keyboard
  // shortcuts. Each pane lives in its own component under $lib/components.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import NoteList from "$lib/components/NoteList.svelte";
  import NoteEditor from "$lib/components/NoteEditor.svelte";
  import BulkActions from "$lib/components/BulkActions.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import UpdatePanel from "$lib/components/UpdatePanel.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";

  let appVersion = $state("");
  let paletteOpen = $state(false);
  let updatePanelOpen = $state(false);

  onMount(() => {
    void library.init();
    void editorPrefs.init();
    void getVersion().then((v) => (appVersion = v));
    updater.start();
    // Tray "Check for Updates…" opens the panel and runs a manual check.
    let unlistenCheck: (() => void) | undefined;
    void listen("updater:check", () => {
      updatePanelOpen = true;
      void updater.checkNow({ manual: true });
    }).then((un) => (unlistenCheck = un));
    const flush = () => library.flushPendingEdits();
    window.addEventListener("blur", flush);
    window.addEventListener("keydown", onKeydown);
    return () => {
      updater.stop();
      unlistenCheck?.();
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
    const mod = e.metaKey || e.ctrlKey;
    // ⌘K toggles the command palette from anywhere, including input fields.
    if (mod && e.key === "k") {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (mod && e.key === "n") {
      e.preventDefault();
      void library.newNote();
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
        library.clearMultiSelect();
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

  async function confirmBulkDestroy() {
    const n = library.multiSelected.size;
    const what = n === 1 ? "this note" : `these ${n} notes`;
    if (window.confirm(`Permanently delete ${what}? This cannot be undone.`)) {
      await library.bulkDestroy();
    }
  }
</script>

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

<CommandPalette bind:open={paletteOpen} />
<UpdatePanel bind:open={updatePanelOpen} currentVersion={appVersion} />

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
