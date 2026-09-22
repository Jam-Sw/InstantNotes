<script lang="ts">
  // A whiteboard's canvas: Excalidraw, a React component, hosted in a Svelte
  // island. Mounted once per note; the editor keys it by note id.
  //
  // Saving. Excalidraw reports every pointer move, scroll, and selection as
  // a change; only a new scene fingerprint counts as an edit. Edits are
  // serialized at most every SERIALIZE_MS and handed to the library's save
  // queue, which debounces, retries, and flushes them on note switch, trash,
  // and quit like any body edit. The library collects an edit still waiting
  // here through onBeforeFlush, and unmounting hands it over too, so no
  // stroke is dropped on the way out.
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
    /** Read once, at mount: after that the canvas is the source of truth. */
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
  // What a board keeps of Excalidraw's view state. Scroll and zoom ride
  // along with the next real edit; on their own they are not worth a save.
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

  /** Hand the waiting edit, if any, to the save queue now. */
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { elements, appState, files } = pending;
    pending = null;
    // Excalidraw keeps deleted elements (and the images they held) in the
    // live scene for undo; a saved board keeps only what is on it.
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
          // A board that remembers where it was scrolled opens there.
          scrollToContent: initial.elements.length > 0 && initial.appState.scrollX === undefined,
        };
        // The stock menu and welcome screen advertise Excalidraw's own site,
        // file saving, and "saved in your browser"; none of that applies to
        // a board inside a note, which saves itself.
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
            // Stored elements are Excalidraw's own output, read back loosely.
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

  // Theme and read-only follow the app live, without remounting the board.
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
