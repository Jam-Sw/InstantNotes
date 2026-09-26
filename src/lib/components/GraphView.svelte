<script lang="ts">
  // The Graph view (SEQUENCE.md unit 13): the library drawn as notes, tags,
  // and Spaces, linked by what each note carries. Derived on every open and
  // every change; nothing about it is stored, positions included.
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { libraryGraph } from "$lib/api/client";
  import { LIBRARY_CHANGED_EVENTS } from "$lib/api/events";
  import { library } from "$lib/stores/library.svelte";
  import { debounce } from "$lib/debounce";
  import {
    buildGraph,
    neighbors,
    nodeRadius,
    startLayout,
    type Graph,
    type GraphNode,
  } from "$lib/graph/layout";

  // Layout work per animation frame, so a large library settles over a few
  // frames instead of freezing the view while it does.
  const FRAME_BUDGET_MS = 12;
  const KIND_LABEL = { note: "Note", tag: "Tag", space: "Space" } as const;
  const ZOOM = { min: 0.2, max: 4 };
  // Note titles show from this zoom up; hubs are always labeled.
  const NOTE_LABEL_ZOOM = 1.3;

  let graph = $state<Graph | null>(null);
  let failed = $state(false);
  let hovered = $state<string | null>(null);
  let width = $state(800);
  let height = $state(600);
  let view = $state({ x: 400, y: 300, k: 1 });
  // Until the user pans or zooms, the view keeps itself framed as the
  // layout settles; after that it stays where they put it.
  let userMoved = false;
  let positions = new Map<string, { x: number; y: number }>();
  let frame: number | null = null;
  let host: HTMLDivElement;

  // Frames where the platform has them (a test DOM may not).
  const hasRaf = typeof requestAnimationFrame === "function";
  const raf = (f: () => void): number =>
    hasRaf ? requestAnimationFrame(f) : (setTimeout(f, 16) as unknown as number);
  const cancelRaf = (id: number) => (hasRaf ? cancelAnimationFrame(id) : clearTimeout(id));

  const byId = $derived(new Map((graph?.nodes ?? []).map((n) => [n.id, n])));
  const currentId = $derived(
    library.selected && byId.has(library.selected.id) ? library.selected.id : null,
  );
  // The lit neighborhood: what the pointer or focus is on, else the open note.
  const lit = $derived.by(() => {
    const focus = hovered ?? currentId;
    return graph && focus ? neighbors(graph, focus) : null;
  });

  function showLabel(n: GraphNode): boolean {
    return n.kind !== "note" || view.k >= NOTE_LABEL_ZOOM || !!lit?.has(n.id);
  }

  async function load() {
    try {
      const built = buildGraph(await libraryGraph());
      failed = false;
      settle(built);
    } catch {
      failed = true;
    }
  }
  const reload = debounce(() => void load(), 80);

  function settle(built: Graph) {
    if (frame !== null) cancelRaf(frame);
    const run = startLayout(built, positions);
    const step = () => {
      frame = null;
      const started = performance.now();
      let rested = false;
      while (!rested && performance.now() - started < FRAME_BUDGET_MS) rested = run.step(4);
      graph = run.snapshot();
      positions = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      if (!userMoved) frameView();
      if (!rested) frame = raf(step);
    };
    step();
  }

  /** Center the open note's neighborhood when it is on the graph, else fit
   *  the whole library. */
  function frameView(all = false) {
    if (!graph || graph.nodes.length === 0) return;
    const around = !all && currentId ? neighbors(graph, currentId) : null;
    const shown = graph.nodes.filter((n) => !around || around.has(n.id));
    const xs = shown.map((n) => n.x);
    const ys = shown.map((n) => n.y);
    const pad = 60;
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(
      ZOOM.max,
      Math.max(ZOOM.min, Math.min(width / (maxX - minX + 2 * pad), height / (maxY - minY + 2 * pad))),
      around ? 1.6 : 1.2,
    );
    view = {
      k,
      x: width / 2 - ((minX + maxX) / 2) * k,
      y: height / 2 - ((minY + maxY) / 2) * k,
    };
  }

  function showAll() {
    userMoved = true;
    frameView(true);
  }

  function open(n: GraphNode) {
    if (n.kind === "note") void library.select(n.id);
    else if (n.kind === "tag") library.setTagFilter(n.id);
    else library.selectWorkspace(n.id);
  }

  function onNodeKey(e: KeyboardEvent, n: GraphNode) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(n);
    }
  }

  // ---- pan and zoom ----

  let drag = $state<{ id: number; x: number; y: number } | null>(null);

  function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".node")) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    userMoved = true;
    view = { ...view, x: view.x + e.clientX - drag.x, y: view.y + e.clientY - drag.y };
    drag = { ...drag, x: e.clientX, y: e.clientY };
  }

  function onPointerUp() {
    drag = null;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    userMoved = true;
    const rect = host.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // A trackpad pinch arrives as a ctrl+wheel with small deltas.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.k * factor));
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
  }

  onMount(() => {
    const measure = () => {
      width = host.clientWidth || width;
      height = host.clientHeight || height;
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    // Registered by hand: a wheel listener has to be non-passive to keep the
    // page from scrolling while it zooms.
    host.addEventListener("wheel", onWheel, { passive: false });
    const unlisten = Promise.all(
      LIBRARY_CHANGED_EVENTS.map((event) => listen(event, () => reload())),
    );
    void load();
    return () => {
      observer?.disconnect();
      host.removeEventListener("wheel", onWheel);
      reload.cancel();
      if (frame !== null) cancelRaf(frame);
      void unlisten.then((offs) => offs.forEach((off) => off()));
    };
  });

  const counts = $derived.by(() => {
    const c = { note: 0, tag: 0, space: 0 };
    for (const n of graph?.nodes ?? []) c[n.kind]++;
    return c;
  });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<section class="graph-pane" aria-label="Graph">
  <header class="graph-bar">
    <h2>Graph</h2>
    {#if graph && graph.nodes.length > 0}
      <span class="graph-counts">
        {plural(counts.note, "note", "notes")} · {plural(counts.tag, "tag", "tags")} ·
        {plural(counts.space, "Space", "Spaces")}
      </span>
      <button class="bar-btn" onclick={showAll}>Show all</button>
    {/if}
  </header>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="graph-host"
    class:panning={drag !== null}
    bind:this={host}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    {#if failed}
      <p class="graph-empty">The graph couldn't load. Your notes are fine; try again in a moment.</p>
    {:else if graph && graph.nodes.length === 0}
      <p class="graph-empty">
        Nothing to draw yet. Tag notes or add them to Spaces, and they appear here, linked by
        what they share.
      </p>
    {:else if graph}
      <svg {width} {height} role="group" aria-label="Notes, tags, and Spaces">
        <g transform="translate({view.x} {view.y}) scale({view.k})">
          {#each graph.edges as e, i (i)}
            {@const a = byId.get(e.source)}
            {@const b = byId.get(e.target)}
            {#if a && b}
              <line
                class="edge"
                class:lit={lit?.has(e.source) && lit?.has(e.target)}
                class:dim={lit && !(lit.has(e.source) && lit.has(e.target))}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              />
            {/if}
          {/each}
          {#each graph.nodes as n (n.id)}
            {@const r = nodeRadius(n)}
            <g
              class="node {n.kind}"
              class:dim={lit && !lit.has(n.id)}
              class:current={currentId === n.id}
              transform="translate({n.x} {n.y})"
              role="button"
              tabindex="0"
              aria-label="{KIND_LABEL[n.kind]}: {n.label}"
              onclick={() => open(n)}
              onkeydown={(e) => onNodeKey(e, n)}
              onpointerenter={() => (hovered = n.id)}
              onpointerleave={() => (hovered = null)}
              onfocus={() => (hovered = n.id)}
              onblur={() => (hovered = null)}
            >
              {#if n.board}
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="2" />
              {:else}
                <circle {r} style:fill={n.kind === "tag" && n.color ? n.color : null} />
              {/if}
              {#if showLabel(n)}
                <text y={r + 12} class:hub={n.kind !== "note"}>{n.label}</text>
              {/if}
            </g>
          {/each}
        </g>
      </svg>
    {/if}
  </div>

  {#if graph && graph.unconnectedNotes > 0}
    <p class="graph-foot">
      {plural(graph.unconnectedNotes, "note", "notes")} with no tags or Spaces
      {graph.unconnectedNotes === 1 ? "isn't" : "aren't"} shown.
      This feature is a W.I.P.
    </p>
  {/if}
</section>

<style>
  .graph-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--bg);
  }
  .graph-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px 8px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }
  .graph-counts {
    color: var(--text-tertiary);
    font-size: 12px;
    font-family: var(--font-meta);
  }
  .bar-btn {
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .bar-btn:hover {
    background: var(--bg-hover);
  }
  .graph-host {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
    border-top: 1px solid var(--border);
    touch-action: none;
  }
  .graph-host.panning {
    cursor: grabbing;
  }
  svg {
    display: block;
  }
  .edge {
    stroke: var(--border);
    stroke-width: 1;
    transition: opacity 120ms ease;
  }
  .edge.lit {
    stroke: var(--text-tertiary);
  }
  .edge.dim {
    opacity: 0.25;
  }
  .node {
    cursor: pointer;
    transition: opacity 120ms ease;
    outline: none;
  }
  .node.dim {
    opacity: 0.2;
  }
  .node circle,
  .node rect {
    fill: var(--text-tertiary);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .node.tag circle {
    fill: var(--tag);
  }
  .node.space circle {
    fill: var(--accent);
    fill-opacity: 0.85;
  }
  .node.current circle,
  .node.current rect,
  .node:focus-visible circle,
  .node:focus-visible rect {
    stroke: var(--accent);
    stroke-width: 2.5;
  }
  .node.current circle,
  .node.current rect {
    fill: var(--accent);
  }
  text {
    fill: var(--text-secondary);
    font-size: 11px;
    text-anchor: middle;
    pointer-events: none;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
  text.hub {
    fill: var(--text);
    font-weight: 600;
  }
  .graph-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 0 48px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
    cursor: default;
  }
  .graph-foot {
    margin: 0;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    color: var(--text-tertiary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
</style>
