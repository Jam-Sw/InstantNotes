<script lang="ts">
  import { onMount } from "svelte";
  import SpaceMarker from "$lib/components/SpaceMarker.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { markerPrefs } from "$lib/stores/markers.svelte";
  import { MARKER_MODES, type MarkerMode } from "$lib/space-colors";

  const OPTIONS: { value: MarkerMode; label: string; sub: string }[] = [
    { value: "color", label: "Color", sub: "A filled disc in the space's color." },
    { value: "flag", label: "Flag", sub: "A small flag in the space's color." },
    { value: "both", label: "Both", sub: "The disc and the flag together." },
  ];

  const EXAMPLE = {
    name: "an example",
    color: "blue" as string | null,
    flag: false,
    slices: [
      { color: "green", noteCount: 3 },
      { color: "orange", noteCount: 2 },
    ],
  };

  // Preview with the person's own space when there is one, so the choice is
  // judged on real colors; an example stands in until a space has a color.
  const subject = $derived.by(() => {
    const own =
      library.workspaces.find((w) => w.color) ??
      library.workspaces.find((w) => library.slicesByWorkspace.has(w.id));
    if (!own) return EXAMPLE;
    return {
      name: `"${own.name}"`,
      color: own.color ?? null,
      flag: own.flag,
      slices: library.slicesByWorkspace.get(own.id) ?? [],
    };
  });

  let group = $state<HTMLDivElement>();
  const selected = $derived(Math.max(0, MARKER_MODES.indexOf(markerPrefs.mode)));

  function selectAt(i: number) {
    const o = OPTIONS[i];
    if (!o) return;
    group?.querySelectorAll("button")[i]?.focus();
    if (o.value !== markerPrefs.mode) markerPrefs.setMode(o.value);
  }

  function onkeydown(e: KeyboardEvent) {
    const last = OPTIONS.length - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") selectAt(selected === last ? 0 : selected + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") selectAt(selected === 0 ? last : selected - 1);
    else if (e.key === "Home") selectAt(0);
    else if (e.key === "End") selectAt(last);
    else return;
    e.preventDefault();
  }

  onMount(() => {
    void markerPrefs.init();
  });
</script>

<div class="markers-pane">
  <span class="group-label">Space marker</span>
  <p class="section-hint">
    How each Space is marked in the sidebar. Right-click a Space to give it a color, or to show its
    flag whatever you pick here. Tags with a color add a ring of slices around the Space's color, one
    slice per tag, sized by how many of its notes carry the tag. Previewed with {subject.name}.
  </p>

  <div class="cards" role="radiogroup" aria-label="Space marker" bind:this={group}>
    {#each OPTIONS as o, i (o.value)}
      <button
        class="card"
        type="button"
        role="radio"
        aria-checked={markerPrefs.mode === o.value}
        tabindex={i === selected ? 0 : -1}
        onclick={() => selectAt(i)}
        {onkeydown}
      >
        <span class="stage">
          <SpaceMarker
            color={subject.color}
            flag={subject.flag}
            slices={subject.slices}
            mode={o.value}
            size={34}
          />
        </span>
        <span class="card-label">{o.label}</span>
        <span class="card-sub">{o.sub}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .markers-pane {
    max-width: 560px;
    margin-top: 28px;
  }
  .group-label {
    display: block;
    margin: 0 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 4px 0 14px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-align: center;
  }
  .card:hover {
    background: var(--bg-hover);
  }
  .card[aria-checked="true"] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .stage {
    display: grid;
    place-items: center;
    min-height: 44px;
  }
  .card-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .card-sub {
    font-size: 11px;
    color: var(--text-secondary);
  }
</style>
