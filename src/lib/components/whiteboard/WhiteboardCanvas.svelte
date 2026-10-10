<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ComponentProps } from "react";
  import type { Root } from "react-dom/client";
  import { loadExcalidraw } from "$lib/whiteboard/excalidraw";
  import {
    boardText,
    parseBoard,
    sceneFingerprint,
    serializeBoard,
    type BoardElement,
  } from "$lib/whiteboard/document";

  type ExcalidrawModule = Awaited<ReturnType<typeof loadExcalidraw>>;
  type ExcalidrawProps = ComponentProps<ExcalidrawModule["Excalidraw"]>;
  type Scene = {
    elements: readonly BoardElement[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };

  interface Props {
    noteId: string;
    surfaceData: string | null | undefined;
    readonly: boolean;
    theme: "light" | "dark";
    onchange: (noteId: string, edit: { surfaceData: string; body: string }) => void;
    registerFlush: (flush: () => void) => () => void;
    onlinkopen: (url: string) => void;
  }

  let { noteId, surfaceData, readonly, theme, onchange, registerFlush, onlinkopen }: Props =
    $props();

  const SERIALIZE_MS = 250;
  const KEPT_APP_STATE = ["viewBackgroundColor", "gridSize", "zoom", "scrollX", "scrollY"];

  const id = untrack(() => noteId);
  const initial = parseBoard(untrack(() => surfaceData));

  let host = $state<HTMLDivElement>();
  let failed = $state(false);
  let root: Root | null = null;
  let render: (() => void) | null = null;
  let savedPrint = sceneFingerprint(initial.elements, initial.files);
  let pending: Scene | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function handleChange(elements: readonly unknown[], appState: object, files: object) {
    const scene = {
      elements: elements as readonly BoardElement[],
      appState: appState as Record<string, unknown>,
      files: files as Record<string, unknown>,
    };
    const print = sceneFingerprint(scene.elements, scene.files);
    if (print === savedPrint) return;
    savedPrint = print;
    pending = scene;
    timer ??= setTimeout(flush, SERIALIZE_MS);
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { elements, appState, files } = pending;
    pending = null;
    const live = elements.filter((el) => !el.isDeleted);
    const used = new Set(live.map((el) => el.fileId).filter((f) => typeof f === "string"));
    const kept = Object.fromEntries(Object.entries(files).filter(([fid]) => used.has(fid)));
    const view = Object.fromEntries(KEPT_APP_STATE.map((k) => [k, appState[k]]));
    onchange(id, {
      surfaceData: serializeBoard({ elements: live, appState: view, files: kept }),
      body: boardText(live),
    });
  }

  onMount(() => {
    let destroyed = false;
    const unregister = registerFlush(flush);
    void (async () => {
      try {
        const [React, ReactDOM, mod] = await Promise.all([
          import("react"),
          import("react-dom/client"),
          loadExcalidraw(),
        ]);
        await import("@excalidraw/excalidraw/index.css");
        if (destroyed || !host) return;
        const { Excalidraw, MainMenu, WelcomeScreen } = mod;
        const h = React.createElement;
        const initialData = {
          elements: initial.elements,
          appState: { ...initial.appState, collaborators: new Map() },
          files: initial.files,
          scrollToContent: initial.elements.length > 0 && initial.appState.scrollX === undefined,
        };
        const menu = h(
          MainMenu,
          { key: "menu" },
          h(MainMenu.DefaultItems.ChangeCanvasBackground),
          h(MainMenu.DefaultItems.ClearCanvas),
          h(MainMenu.DefaultItems.Help),
        );
        const welcome = h(
          WelcomeScreen,
          { key: "welcome" },
          h(WelcomeScreen.Hints.MenuHint),
          h(WelcomeScreen.Hints.ToolbarHint),
          h(WelcomeScreen.Hints.HelpHint),
        );
        root = ReactDOM.createRoot(host);
        render = () => {
          const props: ExcalidrawProps = {
            initialData: initialData as unknown as ExcalidrawProps["initialData"],
            theme,
            viewModeEnabled: readonly,
            aiEnabled: false,
            onChange: (els, state, fileMap) => handleChange(els, state, fileMap),
            onLinkOpen: (element, event) => {
              const link = element.link ?? "";
              if (/^https?:\/\//i.test(link)) {
                event.preventDefault();
                onlinkopen(link);
              }
            },
            UIOptions: {
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                saveAsImage: false,
                toggleTheme: false,
              },
            },
          };
          root?.render(h(Excalidraw, props, menu, welcome));
        };
        render();
      } catch (e) {
        console.error("whiteboard failed to load", e);
        failed = true;
      }
    })();
    return () => {
      destroyed = true;
      flush();
      unregister();
      root?.unmount();
      root = null;
    };
  });

  $effect(() => {
    void theme;
    void readonly;
    untrack(() => render?.());
  });
</script>

<div class="board-host" data-whiteboard bind:this={host}></div>
{#if failed}
  <p class="board-failed">This whiteboard couldn't load. Its drawing is safe and nothing was changed.</p>
{/if}

<style>
  .board-host {
    position: absolute;
    inset: 0;
  }
  .board-failed {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
</style>
