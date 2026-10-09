<script lang="ts">
  // The Graph view (SEQUENCE.md units 13 and 13g): the library drawn as
  // notes, tags, and Spaces, linked by what each note carries, and beside it
  // where the unfiled notes belong. Derived on every open and every change;
  // the only thing stored is a dismissed suggestion.
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import {
    addNoteToWorkspace,
    dismissSpaceSuggestion,
    libraryGraph,
    removeNoteFromWorkspace,
    restoreSpaceSuggestion,
    spaceSuggestions,
  } from "$lib/api/client";
  import type { SpaceSuggestion } from "$lib/api/types";
  import { LIBRARY_CHANGED_EVENTS } from "$lib/api/events";
  import { library } from "$lib/stores/library.svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { debounce } from "$lib/debounce";
  import {
    buildGraph,
    neighbors,
    nodeRadius,
    startLayout,
    type Graph,
    type GraphNode,
  } from "$lib/graph/layout";
  import { FRONT, centroid, projector, turn, type Orbit } from "$lib/graph/projection";
  import { clampLabel, nodeLabel, placeLabels } from "$lib/graph/labels";

  // Layout work per animation frame, so a large library settles over a few
  // frames instead of freezing the view while it does.
  const FRAME_BUDGET_MS = 12;
  const KIND_LABEL = { note: "Note", tag: "Tag", space: "Space" } as const;
  const ZOOM = { min: 0.2, max: 4 };
  // Note titles show from this zoom up; hubs are always labeled.
  const NOTE_LABEL_ZOOM = 1.3;
  // The lens: the open note, its tags and Spaces, and the notes they gather.
  const LENS_HOPS = 2;
  // Pixels of drag an arrow key turns the graph by.
  const KEY_TURN = 20;
  // Suggestions listed at once; the rest come a page at a time, so two
  // hundred of them read as a list, not a wall, and the canvas draws the
  // dashed edges of the rows on screen only.
  const PAGE = 25;

  let graph = $state.raw<Graph | null>(null);
  let failed = $state(false);
  let suggestions = $state<SpaceSuggestion[]>([]);
  let pages = $state(1);
  let hovered = $state<string | null>(null);
  let width = $state(800);
  let height = $state(600);
  let view = $state({ x: 400, y: 300, k: 1 });
  let orbit = $state<Orbit>(FRONT);
  // The lens frames the open note's neighborhood; "Show all" is the escape
  // and stays until the lens is chosen again.
  let lens = $state(true);
  // Until the user pans or zooms, the view keeps itself framed as the
  // layout settles; after that it stays where they put it.
  let userMoved = false;
  let positions = new Map<string, { x: number; y: number; z: number }>();
  let frame: number | null = null;
  let host: HTMLDivElement;
  let lastLib: Awaited<ReturnType<typeof libraryGraph>> | null = null;

  // Frames where the platform has them (a test DOM may not).
  const hasRaf = typeof requestAnimationFrame === "function";
  const raf = (f: () => void): number =>
    hasRaf ? requestAnimationFrame(f) : (setTimeout(f, 16) as unknown as number);
  const cancelRaf = (id: number) => (hasRaf ? cancelAnimationFrame(id) : clearTimeout(id));

  const shown = $derived(suggestions.slice(0, pages * PAGE));
  const more = $derived(suggestions.length - shown.length);
  const suggestedSpace = $derived(new Map(shown.map((s) => [s.noteId, s.spaceName])));
  const agentWritten = $derived(
    new Set(
      agents.recent
        .filter(
          (e) =>
            e.kind === "write" &&
            e.status === "ok" &&
            e.client !== "instantnotes" &&
            e.revertedAt === null,
        )
        .flatMap((e) => e.noteIds),
    ),
  );
  const byId = $derived(new Map((graph?.nodes ?? []).map((n) => [n.id, n])));
  const currentId = $derived(
    library.selected && byId.has(library.selected.id) ? library.selected.id : null,
  );
  // The lit neighborhood: what the pointer or focus is on, one link out;
  // else the open note's lens.
  const lit = $derived.by(() => {
    if (!graph) return null;
    if (hovered) return neighbors(graph, hovered);
    return currentId && lens ? neighbors(graph, currentId, LENS_HOPS) : null;
  });

  // The layout is three-dimensional; what is drawn is it turned by the orbit
  // and seen in perspective, around the center of what the view frames: the
  // open note's lens, else the whole library.
  const pivot = $derived.by(() => {
    const nodes = graph?.nodes ?? [];
    const around = graph && lens && currentId ? neighbors(graph, currentId, LENS_HOPS) : null;
    return centroid(around ? nodes.filter((n) => around.has(n.id)) : nodes);
  });
  const projected = $derived.by(() => {
    const project = projector(orbit, pivot);
    return new Map((graph?.nodes ?? []).map((n) => [n.id, project(n)]));
  });
  // Back to front, so a nearer node paints over the ones behind it.
  const painted = $derived(
    [...(graph?.nodes ?? [])].sort((a, b) => projected.get(b.id)!.depth - projected.get(a.id)!.depth),
  );
  // The labels with room to show, and where: what the user is on first, then
  // hubs by size, then the nearest notes; one that would cover another waits.
  const labeled = $derived.by(() => {
    const candidates = [];
    for (const n of graph?.nodes ?? []) {
      if (!showLabel(n)) continue;
      const p = projected.get(n.id)!;
      const focus =
        n.id === currentId ? 4 : n.id === hovered ? 3 : lit?.has(n.id) ? 2 : 0;
      const hub = n.kind === "note" ? 0 : 1e4 + n.degree * 10;
      const r = nodeRadius(n) * p.scale;
      candidates.push({
        ...nodeLabel(n.id, n.label, p.x, p.y, r, focus * 1e6 + hub - p.depth),
        pinned: focus >= 3,
      });
    }
    const discs = (graph?.nodes ?? []).map((n) => {
      const p = projected.get(n.id)!;
      return { x: p.x, y: p.y, r: nodeRadius(n) * p.scale };
    });
    return placeLabels(candidates, discs);
  });

  const labelsOn = $derived(view.k >= NOTE_LABEL_ZOOM);

  function showLabel(n: GraphNode): boolean {
    return n.kind !== "note" || labelsOn || !!lit?.has(n.id);
  }

  function nodeName(n: GraphNode): string {
    const base = `${KIND_LABEL[n.kind]}: ${n.label}`;
    const space = n.kind === "note" ? suggestedSpace.get(n.id) : undefined;
    const named = space ? `${base}, suggested for ${space}` : base;
    return n.kind === "note" && agentWritten.has(n.id) ? `${named}, written by an agent` : named;
  }

  async function load() {
    try {
      // Suggestions are a help, not the graph: when they fail the graph
      // still draws, with none.
      const [lib, next] = await Promise.all([
        libraryGraph(),
        spaceSuggestions().catch(() => [] as SpaceSuggestion[]),
      ]);
      lastLib = lib;
      suggestions = next;
      failed = false;
      settle(buildGraph(lib, next.slice(0, pages * PAGE)));
    } catch {
      failed = true;
    }
  }
  const reload = debounce(() => void load(), 80);

  /** Redraw from what is already loaded, after the list changed locally. */
  function redraw() {
    if (lastLib) settle(buildGraph(lastLib, shown));
  }

  function settle(built: Graph) {
    if (frame !== null) cancelRaf(frame);
    const run = startLayout(built, positions);
    const step = () => {
      frame = null;
      const started = performance.now();
      let rested = false;
      while (!rested && performance.now() - started < FRAME_BUDGET_MS) rested = run.step(1);
      graph = run.snapshot();
      positions = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y, z: n.z }]));
      if (!userMoved) frameView();
      if (!rested) frame = raf(step);
    };
    step();
  }

  /** Center the open note's lens when it is on the graph and the lens is
   *  on, else fit the whole library. */
  function frameView() {
    if (!graph || graph.nodes.length === 0) return;
    const around = lens && currentId ? neighbors(graph, currentId, LENS_HOPS) : null;
    const shownNodes = graph.nodes
      .filter((n) => !around || around.has(n.id))
      .map((n) => projected.get(n.id)!);
    const xs = shownNodes.map((n) => n.x);
    const ys = shownNodes.map((n) => n.y);
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

  function toggleLens() {
    lens = !lens;
    userMoved = false;
    frameView();
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

  // ---- suggestions ----

  function drop(s: SpaceSuggestion) {
    suggestions = suggestions.filter((x) => !(x.noteId === s.noteId && x.spaceId === s.spaceId));
  }

  /** One tap: the note joins the Space. The membership is the data, and the
   *  model learns from it on the next read; Undo takes it out again. */
  async function accept(s: SpaceSuggestion) {
    drop(s);
    redraw();
    try {
      await addNoteToWorkspace(s.noteId, s.spaceId);
      toasts.show(`Filed "${s.noteTitle}" in ${s.spaceName}`, {
        label: "Undo",
        run: () => void removeNoteFromWorkspace(s.noteId, s.spaceId).catch(() => reload()),
      });
    } catch {
      toasts.show(`Couldn't file "${s.noteTitle}" in ${s.spaceName}.`);
      reload();
    }
  }

  /** "Not this one": the pair is remembered on this device and not shown
   *  again; nothing about the note changes. Undo forgets the dismissal. */
  async function dismiss(s: SpaceSuggestion) {
    drop(s);
    redraw();
    try {
      await dismissSpaceSuggestion(s.noteId, s.spaceId);
      void library.refreshSuggestionCount();
      toasts.show(`Won't suggest ${s.spaceName} for "${s.noteTitle}"`, {
        label: "Undo",
        run: () => void restoreSpaceSuggestion(s.noteId, s.spaceId).then(() => reload(), () => reload()),
      });
    } catch {
      toasts.show(`Couldn't dismiss the suggestion for "${s.noteTitle}".`);
      reload();
    }
  }

  function showMore() {
    pages += 1;
    redraw();
  }

  const percent = (p: number) => `${Math.round(p * 100)}%`;
  const because = (s: SpaceSuggestion) => s.reasons.map((r) => r.label).join(", ");

  // ---- pan and zoom ----

  // A drag pans; with the right button or Shift held, it turns the graph.
  let drag = $state<{ id: number; x: number; y: number; turn: boolean } | null>(null);

  function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".node") && e.button !== 2) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, turn: e.button === 2 || e.shiftKey };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    userMoved = true;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.turn) orbit = turn(orbit, dx, dy);
    else view = { ...view, x: view.x + dx, y: view.y + dy };
    drag = { ...drag, x: e.clientX, y: e.clientY };
  }

  function onHostKey(e: KeyboardEvent) {
    const step = {
      ArrowLeft: [-KEY_TURN, 0],
      ArrowRight: [KEY_TURN, 0],
      ArrowUp: [0, -KEY_TURN],
      ArrowDown: [0, KEY_TURN],
    }[e.key];
    if (!step || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    userMoved = true;
    orbit = turn(orbit, step[0], step[1]);
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
  <header class="pane-header graph-bar" data-tauri-drag-region>
    <h2 data-tauri-drag-region>Graph</h2>
    {#if graph && graph.nodes.length > 0}
      <span class="graph-counts" data-tauri-drag-region>
        {plural(counts.note, "note", "notes")} · {plural(counts.tag, "tag", "tags")} ·
        {plural(counts.space, "Space", "Spaces")}
      </span>
      {#if currentId}
        <button class="bar-btn" onclick={toggleLens}>
          {lens ? "Show all" : "Around this note"}
        </button>
      {/if}
    {/if}
  </header>

  <div class="graph-body">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="graph-host"
      class:panning={drag !== null}
      bind:this={host}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onHostKey}
      oncontextmenu={(e) => e.preventDefault()}
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
              {@const a = projected.get(e.source)}
              {@const b = projected.get(e.target)}
              {#if a && b}
                <line
                  class="edge {e.kind} {e.tagSource ?? ''}"
                  class:lit={lit?.has(e.source) && lit?.has(e.target)}
                  class:dim={lit && !(lit.has(e.source) && lit.has(e.target))}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              {/if}
            {/each}
            {#each painted as n (n.id)}
              {@const p = projected.get(n.id)!}
              {@const r = nodeRadius(n) * p.scale}
              <g
                class="node {n.kind}"
                class:dim={lit && !lit.has(n.id)}
                class:current={currentId === n.id}
                class:suggested={n.suggested}
                transform="translate({p.x} {p.y})"
                role="button"
                tabindex="0"
                aria-label={nodeName(n)}
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
                {#if n.kind === "note" && agentWritten.has(n.id)}
                  <circle class="agent-ring" r={r + 3} />
                {/if}
              </g>
            {/each}
            <!-- Labels above every node, so a nearer node never covers a name
                 that was given room. -->
            {#each painted as n (n.id)}
              {@const at = labeled.get(n.id)}
              {#if at}
                <text
                  class:hub={n.kind !== "note"}
                  class:dim={lit && !lit.has(n.id)}
                  x={at.x}
                  y={at.y}>{clampLabel(n.label)}</text
                >
              {/if}
            {/each}
          </g>
        </svg>
      {/if}
    </div>

    {#if shown.length > 0}
      <!-- The suggestions, as a list beside the canvas: each row is one
           dashed edge, and a row under the pointer or focus lights it. -->
      <aside class="suggestions" aria-label="Filing suggestions">
        <h3>
          Where these belong
          <span class="sug-count">{suggestions.length}</span>
        </h3>
        <ul>
          {#each shown as s (s.noteId + s.spaceId)}
            <li
              class:lit={hovered === s.noteId}
              onpointerenter={() => (hovered = s.noteId)}
              onpointerleave={() => (hovered = null)}
              onfocusin={() => (hovered = s.noteId)}
              onfocusout={() => (hovered = null)}
            >
              <button class="sug-note" title="Open the note" onclick={() => void library.select(s.noteId)}>
                {s.noteTitle || "Untitled"}
              </button>
              <p class="sug-verdict">
                <span class="sug-space">{s.spaceName}</span>
                <span class="sug-pct" title="How sure the suggestion is">{percent(s.probability)}</span>
              </p>
              {#if s.reasons.length > 0}
                <p class="sug-why">because {because(s)}</p>
              {/if}
              <p class="sug-actions">
                <button
                  class="sug-accept"
                  aria-label="Add “{s.noteTitle || 'Untitled'}” to {s.spaceName}"
                  onclick={() => void accept(s)}
                >
                  Add to {s.spaceName}
                </button>
                <button
                  class="sug-dismiss"
                  aria-label="Don't suggest {s.spaceName} for “{s.noteTitle || 'Untitled'}”"
                  onclick={() => void dismiss(s)}
                >
                  Not this
                </button>
              </p>
            </li>
          {/each}
        </ul>
        {#if more > 0}
          <button class="sug-more" onclick={showMore}>
            Show {Math.min(PAGE, more)} more
          </button>
        {/if}
      </aside>
    {/if}
  </div>

  {#if graph && graph.nodes.length > 0}
    <footer class="graph-foot">
      <ul class="legend" aria-label="Legend">
        <li><svg width="22" height="8" aria-hidden="true"><line class="edge tag inline" x1="1" y1="4" x2="21" y2="4" /></svg>tag written in the note</li>
        <li><svg width="22" height="8" aria-hidden="true"><line class="edge tag manual" x1="1" y1="4" x2="21" y2="4" /></svg>tag added</li>
        <li><svg width="22" height="8" aria-hidden="true"><line class="edge space" x1="1" y1="4" x2="21" y2="4" /></svg>Space</li>
        <li><svg width="22" height="8" aria-hidden="true"><line class="edge suggested" x1="1" y1="4" x2="21" y2="4" /></svg>suggested Space</li>      </ul>
      {#if graph.unconnectedNotes > 0}
        <span class="foot-note">
          {plural(graph.unconnectedNotes, "note", "notes")} with no tags or Spaces
          {graph.unconnectedNotes === 1 ? "isn't" : "aren't"} shown.
          {#if graph.populatedSpaces < 2}
            Suggestions start once two Spaces hold notes.
          {/if}
        </span>
      {/if}
    </footer>
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
  /* Layout comes from .pane-header (app.css). */
  .graph-bar {
    gap: 12px;
    padding-right: 16px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }
  .graph-counts {
    color: var(--text-secondary);
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
  .graph-body {
    display: flex;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  .graph-host {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  .graph-host.panning {
    cursor: grabbing;
  }
  svg {
    display: block;
  }
  /* Edges tell their kind by pattern and weight, never by color alone, so
     the legend reads the same for every eye: a written tag is a thin solid
     line, an added tag is dotted, a Space is a heavier solid line, and a
     suggestion is dashed in the accent. */
  .edge {
    stroke: var(--border);
    stroke-width: 1;
    transition: opacity 120ms ease;
  }
  .edge.tag.manual {
    stroke-dasharray: 2 3;
  }
  .edge.space {
    stroke-width: 1.6;
  }
  .edge.suggested {
    stroke: var(--accent);
    stroke-width: 1.4;
    stroke-dasharray: 6 4;
  }
  .edge.lit {
    stroke: var(--text-tertiary);
  }
  .edge.suggested.lit {
    stroke: var(--accent);
    stroke-width: 2;
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
  /* A note drawn for its suggestion alone is hollow and dashed: not yet
     anyone's. */
  .node.suggested circle,
  .node.suggested rect {
    fill: var(--bg);
    stroke: var(--accent);
    stroke-dasharray: 3 2;
  }
  .node.note circle.agent-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.25;
    stroke-opacity: 0.7;
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
    stroke-dasharray: none;
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
  text {
    transition: opacity 120ms ease;
  }
  text.dim {
    opacity: 0.2;
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

  /* ---- the suggestion list ---- */
  .suggestions {
    flex: none;
    width: 280px;
    min-height: 0;
    overflow-y: auto;
    background: var(--surface-list);
    border-left: 1px solid var(--divider);
    padding: 10px 12px 12px;
    font-size: 12.5px;
  }
  .suggestions h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .sug-count {
    color: var(--text-secondary);
    font-family: var(--font-meta);
    font-weight: 500;
  }
  .suggestions ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .suggestions li {
    padding: 8px 8px 9px;
    margin: 0 -8px;
    border-radius: var(--radius);
  }
  .suggestions li.lit {
    background: var(--bg-hover);
  }
  .suggestions li + li {
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius) var(--radius);
  }
  .suggestions p {
    margin: 0;
  }
  .sug-note {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0;
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sug-note:hover {
    text-decoration: underline;
  }
  .sug-verdict {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-top: 2px;
  }
  .sug-space::before {
    content: "→ ";
    color: var(--text-tertiary);
  }
  .sug-space {
    color: var(--accent);
    font-weight: 600;
  }
  .sug-pct {
    color: var(--text-secondary);
    font-family: var(--font-meta);
    font-size: 11px;
  }
  .sug-why {
    margin-top: 2px;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .sug-actions {
    display: flex;
    gap: 6px;
    margin-top: 7px;
  }
  .sug-actions button {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 11.5px;
    color: var(--text-secondary);
  }
  .sug-actions button:hover {
    background: var(--bg-hover);
  }
  .sug-accept {
    color: var(--accent);
    border-color: var(--accent);
  }
  .sug-more {
    width: 100%;
    margin-top: 8px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: 11.5px;
  }
  .sug-more:hover {
    background: var(--bg-hover);
  }

  /* ---- the footer: legend and what is left out ---- */
  .graph-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    align-items: center;
    margin: 0;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11px;
    font-family: var(--font-meta);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend svg {
    display: inline-block;
  }
  .legend .edge {
    stroke: var(--text-tertiary);
  }
  .legend .edge.suggested {
    stroke: var(--accent);
  }
  .foot-note {
    margin-left: auto;
  }
</style>
