<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Editor from "$lib/components/Editor.svelte";
  import WhiteboardCanvas from "$lib/components/whiteboard/WhiteboardCanvas.svelte";
  import SheetGrid from "$lib/components/sheet/SheetGrid.svelte";
  import { EVENTS } from "$lib/api/events";
  import {
    answerPopIn,
    getStickyView,
    openLibrary,
    openUrl,
    popInNote,
    quitApp,
    saveStickyGeometry,
    setStickyCollapsed,
    setStickyLevel,
  } from "$lib/api/client";
  import type { StickyLevel } from "$lib/api/types";
  import { debounce } from "$lib/debounce";
  import { StickyNote } from "$lib/stores/sticky.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { parseActivityLog } from "$lib/agent-activity";
  import { theme } from "$lib/stores/theme.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { imagePrefs } from "$lib/stores/images.svelte";
  import { linkPrefs } from "$lib/stores/links.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { effectiveVariant } from "$lib/themes/apply";
  import { formatExact } from "$lib/format";
  import Toast from "$lib/components/Toast.svelte";
  import LicenseLocked from "$lib/components/LicenseLocked.svelte";
  import { agreements } from "$lib/agreements.svelte";

  const win = getCurrentWindow();
  const noteId = win.label.slice("sticky-".length);
  const sticky = new StickyNote();

  const LEVELS: { id: StickyLevel; label: string; path: string }[] = [
    { id: "float", label: "Keep on top", path: "M8 2v6M5 8h6l-1 3H6zM8 11v3" },
    { id: "normal", label: "Normal window", path: "M3 5h8v7H3zM5 3h8v7" },
    { id: "desktop", label: "On the desktop", path: "M4 4h8v6H4zM2 13h12" },
  ];

  let level = $state<StickyLevel>("float");
  let collapsed = $state(false);
  const boardTheme = $derived(effectiveVariant(theme.activeTheme, theme.resolvedVariant));

  const persistGeometry = debounce(() => void saveStickyGeometry(), 400);

  async function chooseLevel(next: StickyLevel) {
    const previous = level;
    level = next;
    try {
      await setStickyLevel(next);
    } catch {
      level = previous;
      toasts.show("Couldn't change where the sticky sits.");
    }
  }

  function onHeaderMousedown(e: MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    if (e.detail === 2) void toggleCollapsed();
    else if (e.detail === 1) void win.startDragging();
  }

  async function toggleCollapsed() {
    collapsed = !collapsed;
    try {
      await setStickyCollapsed(collapsed);
    } catch {
      collapsed = !collapsed;
    }
  }

  const header = $derived(
    sticky.note
      ? `Created ${formatExact(sticky.note.createdAt)}\nEdited ${formatExact(sticky.note.updatedAt)}\nDouble-click to ${collapsed ? "expand" : "collapse"}`
      : "",
  );

  async function bringBack() {
    try {
      await popInNote(noteId);
      await openLibrary();
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : "Couldn't bring the note back.");
    }
  }

  onMount(() => {
    void sticky.load(noteId);
    void editorPrefs.init();
    void imagePrefs.init();
    void linkPrefs.init();
    void agents.init();
    void getStickyView()
      .then((v) => ({ level, collapsed } = v))
      .catch(() => {});

    const unlisteners = [
      listen(EVENTS.STICKY_CLOSE_REQUESTED, async () => {
        const saved = sticky.gone || (await sticky.flush());
        await answerPopIn(saved);
      }),
      listen(EVENTS.APP_QUIT_REQUESTED, async () => {
        await sticky.flush();
        await quitApp();
      }),
      listen(EVENTS.NOTES_CHANGED, () => void sticky.refreshMeta()),
      listen<unknown>(EVENTS.LIBRARY_EXTERNAL_CHANGE, (e) => {
        void sticky.adoptExternal(parseActivityLog(e.payload));
      }),
      win.onMoved(() => persistGeometry()),
      win.onResized(() => persistGeometry()),
      win.onFocusChanged(({ payload: focused }) => {
        if (focused) void theme.init();
        else void sticky.flush();
      }),
    ];
    return () => {
      persistGeometry.flush();
      for (const un of unlisteners) void un.then((fn) => fn());
    };
  });

  $effect(() => {
    if (sticky.gone) void popInNote(noteId).catch(() => {});
  });
</script>

<div class="sticky" class:collapsed>
  <header onmousedown={onHeaderMousedown} title={header}>
    <span class="title">
      {sticky.note?.title || "Untitled"}
    </span>
    <div class="levels" role="radiogroup" aria-label="Where the sticky sits">
      {#each LEVELS as l (l.id)}
        <button
          class="icon"
          class:on={level === l.id}
          role="radio"
          aria-checked={level === l.id}
          aria-label={l.label}
          title={l.label}
          onclick={() => void chooseLevel(l.id)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={l.path} /></svg>
        </button>
      {/each}
    </div>
    <button
      class="icon"
      aria-label="Back to library"
      title="Back to library"
      onclick={() => void bringBack()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 4 5 11M5 6v5h5" /></svg>
    </button>
  </header>

  {#if !agreements.done && !collapsed}
    <LicenseLocked />
  {:else if sticky.note && !collapsed}
    {#if sticky.note.contentKind === "whiteboard"}
      <div class="body board">
        <WhiteboardCanvas
          noteId={sticky.note.id}
          surfaceData={sticky.note.surfaceData}
          readonly={sticky.gone}
          theme={boardTheme}
          onchange={(id, edit) => sticky.editBoard(id, edit)}
          registerFlush={(flush) => sticky.onBeforeFlush(flush)}
          onlinkopen={(url) => void openUrl(url)}
        />
      </div>
    {:else if sticky.note.contentKind === "sheet"}
      <div class="body grid">
        <SheetGrid
          noteId={sticky.note.id}
          surfaceData={sticky.note.surfaceData}
          readonly={sticky.gone}
          onchange={(id, surfaceData) => sticky.editSheet(id, surfaceData)}
          registerFlush={(flush) => sticky.onBeforeFlush(flush)}
        />
      </div>
    {:else}
      <div
        class="body"
        style="--editor-zoom: {editorPrefs.zoom}; --image-max-height: {imagePrefs.maxPreviewHeight}px"
      >
        <Editor
          value={sticky.note.body}
          docKey={sticky.note.id}
          placeholder="Write here…"
          previewMode
          onchange={(v) => sticky.editBody(v)}
        />
      </div>
    {/if}
  {/if}

  {#if !collapsed && (sticky.saveState === "failed" || sticky.error)}
    <footer class="status">{sticky.error ?? "Not saved"}</footer>
  {/if}
</div>

<Toast />

<style>
  :global(html),
  :global(body) {
    background: transparent;
    overflow: hidden;
  }

  .sticky {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    height: 28px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sidebar);
    user-select: none;
    -webkit-user-select: none;
  }
  .collapsed header {
    border-bottom: none;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .levels {
    display: flex;
    gap: 1px;
    padding: 1px;
    border-radius: var(--radius);
    background: var(--bg-hover);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    border-radius: calc(var(--radius) - 1px);
    color: var(--text-tertiary);
    cursor: default;
  }
  .icon:hover {
    color: var(--text);
  }
  .icon.on {
    background: var(--bg);
    color: var(--accent-text);
  }
  .icon svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .body {
    flex: 1;
    min-height: 0;
  }
  .board {
    position: relative;
  }
  .grid {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .status {
    padding: 4px 12px;
    border-top: 1px solid var(--border);
    color: var(--danger);
    font-size: 11px;
    font-family: var(--font-meta);
  }
</style>
