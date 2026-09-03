<script lang="ts">
  // Freeform whiteboard host. Excalidraw owns the canvas (boxes, arrows, ink).
  import ExcalidrawCanvas from "./ExcalidrawCanvas.svelte";

  interface Props {
    noteId: string;
    surfaceData?: string | null;
    readonly?: boolean;
    onchange?: (serialized: string) => void;
  }

  let { noteId, surfaceData = null, readonly = false, onchange }: Props = $props();
</script>

<div class="wb-surface">
  <div class="wb-chrome">
    <span class="wb-badge" title="This note is permanently a whiteboard">Whiteboard</span>
    <span class="wb-engine" title="Canvas engine">Excalidraw · freeform</span>
  </div>
  <div class="wb-host">
    <ExcalidrawCanvas {noteId} {surfaceData} {readonly} {onchange} />
  </div>
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
  }
</style>
