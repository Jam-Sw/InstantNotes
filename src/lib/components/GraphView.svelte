<script lang="ts">
  import { onMount } from "svelte";
  import {
    addNoteToWorkspace,
    dismissSpaceSuggestion,
    libraryGraph,
    removeNoteFromWorkspace,
    restoreSpaceSuggestion,
    spaceSuggestions,
  } from "$lib/api/client";
  import type { SpaceSuggestion } from "$lib/api/types";
  import { LIBRARY_CHANGED_EVENTS, listen } from "$lib/api/events";
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
  import {
    FRONT,
    centreView,
    centroid,
    clampZoom,
    ease,
    fog,
    mix3,
    mixView,
    pinch,
    projector,
    reach,
    ring,
    turn,
    wheelKind,
    zoomAt,
    type Orbit,
    type Point3,
    type View,
    type WheelKind,
  } from "$lib/graph/projection";
  import { clampLabel, nodeLabel, placeLabels } from "$lib/graph/labels";

  const FRAME_BUDGET_MS = 12;
  const KIND_LABEL = { note: "Note", tag: "Tag", space: "Space" } as const;
  const LENS_HOPS = 2;
  const KEY_TURN = 20;
  const PAGE = 25;
  const TAP_SLOP = 5;
  const DOUBLE_MS = 300;
  const GLIDE_MS = 320;
  const WHEEL_GAP_MS = 200;
  const RING_MARGIN = 30;
  const PIVOT_ARM = 14;

  let graph = $state.raw<Graph | null>(null);
  let failed = $state(false);
  let suggestions = $state<SpaceSuggestion[]>([]);
  let pages = $state(1);
  let hovered = $state<string | null>(null);
  let width = $state(800);
  let height = $state(600);
  let view = $state<View>({ x: 400, y: 300, k: 1 });
  let orbit = $state<Orbit>(FRONT);
  let lens = $state(true);
  let centre = $state<string | null>(null);
  let glide = $state<{ from: Point3; t: number } | null>(null);
  let grabbing = $state(false);
  let userMoved = false;
  let glideFrame: number | null = null;
  let pendingOpen: ReturnType<typeof setTimeout> | null = null;
  let lastTap: { id: string | null; at: number } | null = null;
  let wheelLatch: { kind: WheelKind; at: number } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pressedAt = { x: 0, y: 0 };
  let panning = false;
  let dragged = false;
  let positions = new Map<string, { x: number; y: number; z: number }>();
  let frame: number | null = null;
  let host: HTMLDivElement;
  let lastLib: Awaited<ReturnType<typeof libraryGraph>> | null = null;

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
  const lit = $derived.by(() => {
    if (!graph) return null;
    if (hovered) return neighbors(graph, hovered);
    return currentId && lens ? neighbors(graph, currentId, LENS_HOPS) : null;
  });

  const framed = $derived.by(() => {
    const nodes = graph?.nodes ?? [];
    const around = graph && lens && currentId ? neighbors(graph, currentId, LENS_HOPS) : null;
    return around ? nodes.filter((n) => around.has(n.id)) : nodes;
  });
  const aim = $derived.by((): Point3 => {
    const c = centre ? byId.get(centre) : undefined;
    return c ? { x: c.x, y: c.y, z: c.z } : centroid(framed);
  });
  const pivot = $derived(glide ? mix3(glide.from, aim, ease(glide.t)) : aim);
  const project = $derived(projector(orbit, pivot));
  const projected = $derived(new Map((graph?.nodes ?? []).map((n) => [n.id, project(n)])));
  const painted = $derived(
    [...(graph?.nodes ?? [])].sort((a, b) => projected.get(b.id)!.depth - projected.get(a.id)!.depth),
  );
  const rings = $derived.by(() => {
    const r = reach(framed, pivot) + RING_MARGIN;
    return (["ground", "upright"] as const).map((plane) => ({
      plane,
      points: ring(pivot, r, plane)
        .map(project)
        .map((p) => `${p.x},${p.y}`)
        .join(" "),
    }));
  });
  const arms = $derived(
    [
      { x: PIVOT_ARM, y: 0, z: 0 },
      { x: 0, y: PIVOT_ARM, z: 0 },
      { x: 0, y: 0, z: PIVOT_ARM },
    ].map((d) => [
      project({ x: pivot.x - d.x, y: pivot.y - d.y, z: pivot.z - d.z }),
      project({ x: pivot.x + d.x, y: pivot.y + d.y, z: pivot.z + d.z }),
    ]),
  );
  const focusId = $derived(hovered ?? centre ?? currentId);
  const named = $derived(graph && focusId && byId.has(focusId) ? neighbors(graph, focusId) : null);
  const labeled = $derived.by(() => {
    const candidates = [];
    const discs = [];
    for (const n of graph?.nodes ?? []) {
      const p = projected.get(n.id)!;
      const x = view.x + p.x * view.k;
      const y = view.y + p.y * view.k;
      const r = nodeRadius(n) * p.scale * view.k;
      discs.push({ x, y, r });
      if (!showLabel(n)) continue;
      const focus =
        n.id === currentId ? 4 : n.id === hovered || n.id === centre ? 3 : named?.has(n.id) ? 2 : 0;
      const hub = n.kind === "note" ? 0 : 1e4 + n.degree * 10;
      candidates.push({
        ...nodeLabel(n.id, n.label, x, y, r, focus * 1e6 + hub - p.depth),
        pinned: focus >= 3,
      });
    }
    return placeLabels(candidates, discs);
  });

  function showLabel(n: GraphNode): boolean {
    return n.kind !== "note" || !!named?.has(n.id);
  }

  function shade(n: GraphNode, depth: number): number {
    return n.id === currentId || n.id === centre || n.id === hovered ? 1 : fog(depth);
  }

  function nodeName(n: GraphNode): string {
    const base = `${KIND_LABEL[n.kind]}: ${n.label}`;
    const space = n.kind === "note" ? suggestedSpace.get(n.id) : undefined;
    const named = space ? `${base}, suggested for ${space}` : base;
    return n.kind === "note" && agentWritten.has(n.id) ? `${named}, written by an agent` : named;
  }

  async function load() {
    try {
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

  function frameView() {
    if (!graph || graph.nodes.length === 0) return;
    const around = lens && !!currentId;
    const shownNodes = framed.map((n) => projected.get(n.id)!);
    const xs = shownNodes.map((n) => n.x);
    const ys = shownNodes.map((n) => n.y);
    const pad = 60;
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(
      clampZoom(Math.min(width / (maxX - minX + 2 * pad), height / (maxY - minY + 2 * pad))),
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
    stopGlide();
    centre = null;
    userMoved = false;
    frameView();
  }

  function resetView() {
    stopGlide();
    centre = null;
    orbit = FRONT;
    userMoved = false;
    frameView();
  }

  function stopGlide() {
    if (glideFrame !== null) cancelRaf(glideFrame);
    glideFrame = null;
    glide = null;
  }

  function centreOn(n: GraphNode) {
    const from = pivot;
    const fromView = view;
    stopGlide();
    centre = n.id;
    userMoved = true;
    const began = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - began) / GLIDE_MS);
      glide = t < 1 ? { from, t } : null;
      view = mixView(fromView, centreView(fromView.k, aim, width, height), ease(t));
      glideFrame = t < 1 ? raf(step) : null;
    };
    step();
  }

  function open(n: GraphNode) {
    if (n.kind === "note") void library.select(n.id);
    else if (n.kind === "tag") library.setTagFilter(n.id);
    else library.selectWorkspace(n.id);
  }

  function cancelOpen() {
    if (pendingOpen !== null) clearTimeout(pendingOpen);
    pendingOpen = null;
  }

  function isDouble(id: string | null): boolean {
    const now = Date.now();
    const twice = lastTap !== null && lastTap.id === id && now - lastTap.at < DOUBLE_MS;
    lastTap = twice ? null : { id, at: now };
    return twice;
  }

  function onNodeClick(n: GraphNode) {
    if (dragged) return;
    cancelOpen();
    if (isDouble(n.id)) {
      centreOn(n);
      return;
    }
    pendingOpen = setTimeout(() => {
      pendingOpen = null;
      open(n);
    }, DOUBLE_MS);
  }

  function onNodeKey(e: KeyboardEvent, n: GraphNode) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(n);
    }
  }

  function drop(s: SpaceSuggestion) {
    suggestions = suggestions.filter((x) => !(x.noteId === s.noteId && x.spaceId === s.spaceId));
  }

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

  function local(e: PointerEvent | WheelEvent) {
    const rect = host.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button > 2) return;
    const at = local(e);
    pointers.set(e.pointerId, at);
    if (pointers.size === 1) {
      pressedAt = at;
      panning = e.button !== 0 || e.shiftKey;
      dragged = false;
    } else {
      dragged = true;
      grabbing = true;
      for (const id of pointers.keys()) host.setPointerCapture?.(id);
    }
  }

  function onPointerMove(e: PointerEvent) {
    const before = pointers.get(e.pointerId);
    if (!before) return;
    const at = local(e);
    if (pointers.size >= 2) {
      const ids = [...pointers.keys()].slice(0, 2);
      if (!ids.includes(e.pointerId)) return;
      const pair = () => ids.map((id) => pointers.get(id)!) as [typeof at, typeof at];
      const was = pair();
      pointers.set(e.pointerId, at);
      stopGlide();
      userMoved = true;
      view = pinch(view, was, pair());
      return;
    }
    pointers.set(e.pointerId, at);
    if (!dragged) {
      if (Math.hypot(at.x - pressedAt.x, at.y - pressedAt.y) < TAP_SLOP) return;
      dragged = true;
      grabbing = true;
      host.setPointerCapture?.(e.pointerId);
    }
    userMoved = true;
    const dx = at.x - before.x;
    const dy = at.y - before.y;
    if (panning) {
      stopGlide();
      view = { ...view, x: view.x + dx, y: view.y + dy };
    } else orbit = turn(orbit, dx, dy);
  }

  function onPointerUp(e: PointerEvent) {
    const tapped = !dragged && pointers.size === 1 && pointers.has(e.pointerId);
    release(e);
    if (tapped && e.button === 0 && !(e.target as Element).closest(".node") && isDouble(null)) {
      resetView();
    }
  }

  function release(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) grabbing = false;
    if (pointers.size === 1) panning = false;
  }

  function onHostKey(e: KeyboardEvent) {
    if ((e.key === "Home" || e.key === "0") && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      resetView();
      return;
    }
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

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    userMoved = true;
    stopGlide();
    const latched = wheelLatch && e.timeStamp - wheelLatch.at < WHEEL_GAP_MS ? wheelLatch.kind : null;
    const kind = e.ctrlKey ? "zoom" : (latched ?? wheelKind(e));
    wheelLatch = { kind, at: e.timeStamp };
    if (kind === "pan") {
      view = { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY };
      return;
    }
    const { x, y } = local(e);
    const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const factor = Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.002));
    view = zoomAt(view, clampZoom(view.k * factor), x, y);
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
    host.addEventListener("wheel", onWheel, { passive: false });
    const unlisten = Promise.all(
      LIBRARY_CHANGED_EVENTS.map((event) => listen(event, () => reload())),
    );
    void load();
    return () => {
      observer?.disconnect();
      host.removeEventListener("wheel", onWheel);
      reload.cancel();
      cancelOpen();
      stopGlide();
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
      <span class="bar-actions">
        {#if currentId}
          <button class="bar-btn" onclick={toggleLens}>
            {lens ? "Show all" : "Around this note"}
          </button>
        {/if}
        <button class="bar-btn" onclick={resetView}>Reset view</button>
      </span>
    {/if}
  </header>

  <div class="graph-body">
    <div
      class="graph-host"
      class:panning={grabbing}
      bind:this={host}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={release}
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
            {#each rings as g (g.plane)}
              <polyline class="ring {g.plane}" points={g.points} vector-effect="non-scaling-stroke" />
            {/each}
            {#each graph.edges as e, i (i)}
              {@const a = projected.get(e.source)}
              {@const b = projected.get(e.target)}
              {#if a && b}
                <line
                  class="edge {e.kind} {e.tagSource ?? ''}"
                  class:lit={lit?.has(e.source) && lit?.has(e.target)}
                  class:dim={lit && !(lit.has(e.source) && lit.has(e.target))}
                  style:stroke-opacity={fog((a.depth + b.depth) / 2)}
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
              {@const shown = shade(n, p.depth)}
              <g
                class="node {n.kind}"
                class:dim={lit && !lit.has(n.id)}
                class:current={currentId === n.id}
                class:centred={centre === n.id}
                class:suggested={n.suggested}
                transform="translate({p.x} {p.y})"
                role="button"
                tabindex="0"
                aria-label={nodeName(n)}
                onclick={() => onNodeClick(n)}
                onkeydown={(e) => onNodeKey(e, n)}
                onpointerenter={() => (hovered = n.id)}
                onpointerleave={() => (hovered = null)}
                onfocus={() => (hovered = n.id)}
                onblur={() => (hovered = null)}
              >
                {#if centre === n.id}
                  <circle class="centre-ring" r={r + 5} />
                {/if}
                {#if n.board}
                  <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="2" style:opacity={shown} />
                {:else}
                  <circle
                    {r}
                    style:fill={n.kind === "tag" && n.color ? n.color : null}
                    style:opacity={shown}
                  />
                {/if}
                {#if n.kind === "note" && agentWritten.has(n.id)}
                  <circle class="agent-ring" r={r + 3} style:opacity={shown} />
                {/if}
              </g>
            {/each}
            <g class="pivot" aria-hidden="true">
              {#each arms as [a, b], i (i)}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} vector-effect="non-scaling-stroke" />
              {/each}
            </g>
          </g>
          <g class="labels">
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
  .bar-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .bar-btn {
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
  .ring {
    fill: none;
    stroke: var(--text-tertiary);
    stroke-width: 1;
    stroke-opacity: 0.22;
    stroke-dasharray: 2 5;
    pointer-events: none;
  }
  .ring.ground {
    stroke-opacity: 0.3;
    stroke-dasharray: none;
  }
  .pivot line {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-opacity: 0.75;
    stroke-linecap: round;
  }
  .pivot {
    pointer-events: none;
  }
  .node.centred circle.centre-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-opacity: 0.6;
  }
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
