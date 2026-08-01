<script lang="ts">
  // Minimal Svelte Flow board so convert-to-whiteboard feels real:
  // drag nodes, connect edges, add/rename/delete. Persists into surfaceData.
  import {
    SvelteFlow,
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    Panel,
    addEdge,
    type Connection,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import {
    normalizeFlowData,
    parseSurfaceDocument,
    serializeSurfaceDocument,
    withSurfaceData,
    FLOW_ENGINE_ID,
    type FlowData,
  } from "$lib/whiteboard/document";

  interface Props {
    noteId: string;
    surfaceData?: string | null;
    readonly?: boolean;
    onchange?: (serialized: string) => void;
  }

  let { noteId, surfaceData = null, readonly = false, onchange }: Props = $props();

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let loadedFor = "";
  let seq = 0;

  function load(raw: string | null | undefined) {
    const doc = parseSurfaceDocument(raw);
    const data = normalizeFlowData(doc.data);
    nodes = data.nodes.map((n) => ({ ...n, data: { ...n.data } })) as Node[];
    edges = data.edges.map((e) => ({ ...e })) as Edge[];
    seq = nodes.reduce((m, n) => {
      const num = Number(n.id);
      return Number.isFinite(num) ? Math.max(m, num) : m;
    }, 0);
    loadedFor = noteId;
  }

  function persist() {
    if (readonly || !onchange) return;
    const data: FlowData = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { ...n.position },
        data: { label: String((n.data as { label?: string })?.label ?? "") },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
    const doc = withSurfaceData(parseSurfaceDocument(surfaceData), data, FLOW_ENGINE_ID);
    onchange(serializeSurfaceDocument(doc));
  }

  function onConnect(connection: Connection) {
    edges = addEdge(connection, edges);
    persist();
  }

  function onNodeDragStop() {
    persist();
  }

  function onDelete() {
    // nodes/edges already updated via bind; persist after delete settles.
    queueMicrotask(() => persist());
  }

  function addNode() {
    if (readonly) return;
    seq += 1;
    const id = String(seq);
    nodes = [
      ...nodes,
      {
        id,
        position: { x: 120 + (seq % 5) * 24, y: 80 + (seq % 4) * 40 },
        data: { label: `Node ${id}` },
      },
    ];
    persist();
  }

  function onNodeContextMenu({
    node,
    event,
  }: {
    node: Node;
    event: MouseEvent;
  }) {
    if (readonly) return;
    event.preventDefault();
    const current = String((node.data as { label?: string })?.label ?? "");
    const next = window.prompt("Node label", current);
    if (next == null || next === current) return;
    nodes = nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, label: next } } : n,
    );
    persist();
  }

  // Load when the open note changes (not on every save writeback).
  $effect(() => {
    const id = noteId;
    if (loadedFor === id && nodes.length > 0) return;
    load(surfaceData);
  });
</script>

<div class="flow-wrap">
  <SvelteFlow
    bind:nodes
    bind:edges
    fitView
    colorMode="dark"
    nodesDraggable={!readonly}
    nodesConnectable={!readonly}
    elementsSelectable={!readonly}
    onconnect={onConnect}
    onnodedragstop={onNodeDragStop}
    ondelete={onDelete}
    onnodecontextmenu={onNodeContextMenu}
    deleteKey={readonly ? null : ["Backspace", "Delete"]}
  >
    <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
    <Controls />
    <MiniMap pannable zoomable />
    {#if !readonly}
      <Panel position="top-left">
        <div class="tools">
          <button type="button" class="tool" onclick={addNode}>Add node</button>
          <span class="hint">Drag handles to connect · right-click rename · Delete to remove</span>
        </div>
      </Panel>
    {/if}
  </SvelteFlow>
</div>

<style>
  .flow-wrap {
    position: absolute;
    inset: 0;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-sidebar);
    box-shadow: var(--shadow);
  }
  .tool {
    padding: 4px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }
  .tool:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }
  .hint {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  /* Theme the default xyflow chrome toward InstantNotes tokens. */
  .flow-wrap :global(.svelte-flow) {
    --xy-background-color: var(--bg);
    --xy-node-background-color: var(--bg-sidebar);
    --xy-node-border: 1px solid var(--border);
    --xy-node-color: var(--text);
    --xy-edge-stroke: var(--text-secondary);
    --xy-attribution-background-color: transparent;
  }
</style>
