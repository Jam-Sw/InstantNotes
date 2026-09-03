<script lang="ts">
  // Freeform board via Excalidraw (React island). Empty canvas; boxes, arrows,
  // freehand, frames — not a rigid node graph.
  import { onDestroy } from "svelte";
  import type { Root } from "react-dom/client";
  import {
    emptyScene,
    normalizeScene,
    parseSurfaceDocument,
    serializeSurfaceDocument,
    withSurfaceData,
    EXCALIDRAW_ENGINE_ID,
    type ExcalidrawScene,
  } from "$lib/whiteboard/document";

  interface Props {
    noteId: string;
    surfaceData?: string | null;
    readonly?: boolean;
    onchange?: (serialized: string) => void;
  }

  let { noteId, surfaceData = null, readonly = false, onchange }: Props = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let mountedFor = "";
  let root: Root | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let mountGen = 0;

  function sceneFromRaw(raw: string | null | undefined): ExcalidrawScene {
    return normalizeScene(parseSurfaceDocument(raw).data);
  }

  function scheduleSave(scene: ExcalidrawScene) {
    if (readonly || !onchange) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const doc = withSurfaceData(null, scene, EXCALIDRAW_ENGINE_ID);
      onchange(serializeSurfaceDocument(doc));
    }, 400);
  }

  async function mount(raw: string | null | undefined) {
    if (!hostEl) return;
    const gen = ++mountGen;
    disposeRootOnly();

    const [{ createElement }, { createRoot }, excalidrawMod] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("@excalidraw/excalidraw"),
    ]);
    await import("@excalidraw/excalidraw/index.css");
    if (gen !== mountGen || !hostEl) return;

    const Excalidraw = excalidrawMod.Excalidraw;
    const scene = sceneFromRaw(raw);

    // Excalidraw's element/appState types are deep; keep the island loosely typed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = {
      initialData: {
        elements: scene.elements,
        appState: {
          ...emptyScene().appState,
          ...(scene.appState ?? {}),
          collaborators: new Map(),
        },
        files: scene.files ?? {},
        scrollToContent: scene.elements.length > 0,
      },
      viewModeEnabled: readonly,
      zenModeEnabled: false,
      gridModeEnabled: false,
      theme: "dark",
      UIOptions: {
        canvasActions: {
          loadScene: false,
          export: { saveFileToDisk: true },
          toggleTheme: false,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange: (elements: any[], appState: any, files: any) => {
        scheduleSave({
          elements: elements ?? [],
          appState: {
            viewBackgroundColor: appState?.viewBackgroundColor ?? "transparent",
            currentItemFontFamily: appState?.currentItemFontFamily,
            zoom: appState?.zoom,
            scrollX: appState?.scrollX,
            scrollY: appState?.scrollY,
          },
          files: files ?? {},
        });
      },
    };

    root = createRoot(hostEl);
    root.render(createElement(Excalidraw, props));
    mountedFor = noteId;
  }

  function disposeRootOnly() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (root) {
      try {
        root.unmount();
      } catch {
        // ignore
      }
      root = null;
    }
    if (hostEl) hostEl.replaceChildren();
  }

  onDestroy(() => {
    mountGen += 1;
    disposeRootOnly();
  });

  $effect(() => {
    const host = hostEl;
    const id = noteId;
    if (!host) return;
    if (mountedFor === id && root) return;
    void mount(surfaceData);
  });
</script>

<div class="excal-wrap" bind:this={hostEl}></div>

<style>
  .excal-wrap {
    position: absolute;
    inset: 0;
    min-height: 0;
  }
  .excal-wrap :global(.excalidraw) {
    height: 100% !important;
  }
</style>
