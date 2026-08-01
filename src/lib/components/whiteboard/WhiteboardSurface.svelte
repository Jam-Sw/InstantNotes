<script lang="ts">
  // Host chrome for a whiteboard note: mounts the registered adapter into a
  // full-height canvas area. InstantNotes owns this shell; engines plug in.
  import { onDestroy } from "svelte";
  import { parseSurfaceDocument, withSurfaceData, serializeSurfaceDocument } from "$lib/whiteboard/document";
  import { getAdapter } from "$lib/whiteboard/registry";
  import type { WhiteboardMountHandle } from "$lib/whiteboard/types";

  interface Props {
    /** Remount when the open note changes; ignore surfaceData churn from saves. */
    noteId: string;
    surfaceData?: string | null;
    readonly?: boolean;
    onchange?: (serialized: string) => void;
  }

  let { noteId, surfaceData = null, readonly = false, onchange }: Props = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let handle: WhiteboardMountHandle | null = null;
  let mountedFor = "";
  let engineLabel = $state("");

  function remount(raw: string | null | undefined) {
    handle?.dispose();
    handle = null;
    if (!hostEl) return;

    const doc = parseSurfaceDocument(raw);
    const adapter = getAdapter(doc.engine);
    engineLabel = adapter.label;
    mountedFor = noteId;

    handle = adapter.mount(hostEl, {
      data: doc.data,
      readonly,
      onChange: (data) => {
        if (readonly || !onchange) return;
        const next = withSurfaceData(doc, data, adapter.id);
        onchange(serializeSurfaceDocument(next));
      },
    });
  }

  onDestroy(() => {
    handle?.dispose();
    handle = null;
  });

  // Mount (or remount) when the host node, open note, or readonly flag changes.
  // Do not remount on every surfaceData writeback from our own saves.
  $effect(() => {
    const host = hostEl;
    const id = noteId;
    const ro = readonly;
    if (!host) return;
    if (mountedFor === id && handle) {
      void ro;
      return;
    }
    remount(surfaceData);
  });
</script>

<div class="wb-surface">
  <div class="wb-chrome">
    <span class="wb-badge" title="This note is permanently a whiteboard">Whiteboard</span>
    <span class="wb-engine" title="Active canvas engine">{engineLabel || "…"}</span>
  </div>
  <div class="wb-host" bind:this={hostEl} tabindex="-1"></div>
</div>

<style>
  .wb-surface {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .wb-chrome {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .wb-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--accent-text);
    background: var(--accent-soft);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 2px 8px;
  }
  .wb-engine {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .wb-host {
    flex: 1;
    min-height: 0;
    position: relative;
    outline: none;
  }

  /* Shell adapter styles live here so the placeholder looks native to themes. */
  .wb-host :global(.wb-shell-host),
  .wb-host :global(.wb-shell) {
    position: absolute;
    inset: 0;
  }
  .wb-host :global(.wb-shell) {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .wb-host :global(.wb-shell-grid) {
    position: absolute;
    inset: 0;
    background-color: var(--bg);
    background-image: radial-gradient(var(--border) 1px, transparent 1px);
    background-size: 20px 20px;
    opacity: 0.85;
  }
  .wb-host :global(.wb-shell-card) {
    position: relative;
    z-index: 1;
    max-width: 360px;
    margin: 24px;
    padding: 18px 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--bg-sidebar);
    box-shadow: var(--shadow);
  }
  .wb-host :global(.wb-shell-title) {
    font-size: 14px;
    font-weight: 650;
    margin-bottom: 8px;
  }
  .wb-host :global(.wb-shell-body) {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .wb-host :global(.wb-shell-meta) {
    margin: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
</style>
