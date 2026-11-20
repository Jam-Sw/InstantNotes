<script lang="ts">
  import { onMount } from "svelte";
  import { graphPrefs, GRAPH_DEFAULTS, SCALE_RANGE, type GraphLabels } from "$lib/stores/graph.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";

  const LABEL_OPTIONS: { value: GraphLabels; label: string }[] = [
    { value: "focus", label: "Focus" },
    { value: "all", label: "All" },
    { value: "none", label: "None" },
  ];

  const HOP_OPTIONS = [
    { value: "1", label: "1" },
    { value: "2", label: "2" },
    { value: "3", label: "3" },
  ];

  onMount(() => {
    void graphPrefs.init();
  });
</script>

<div class="graph-pane-settings">
  <h2>Graph</h2>

  <SegmentedRow
    label="Labels"
    options={LABEL_OPTIONS}
    value={graphPrefs.labels}
    reset={graphPrefs.labels !== GRAPH_DEFAULTS.labels ? () => graphPrefs.setLabels(GRAPH_DEFAULTS.labels) : undefined}
    onchange={(v) => graphPrefs.setLabels(v)}
  />
  <PrefRow
    label="Node size"
    reset={graphPrefs.nodeSize !== GRAPH_DEFAULTS.nodeSize
      ? () => graphPrefs.setNodeSize(GRAPH_DEFAULTS.nodeSize)
      : undefined}
  >
    {#snippet control()}
      <div class="slider-cell">
        <input
          type="range"
          min={SCALE_RANGE.min}
          max={SCALE_RANGE.max}
          step={SCALE_RANGE.step}
          value={graphPrefs.nodeSize}
          oninput={(e) => graphPrefs.setNodeSize(+e.currentTarget.value)}
          aria-label="Node size"
        />
        <span class="slider-val">{graphPrefs.nodeSize.toFixed(1)}</span>
      </div>
    {/snippet}
  </PrefRow>

  <details class="more">
    <summary>More</summary>
    <PrefRow
      label="Spread"
      reset={graphPrefs.spread !== GRAPH_DEFAULTS.spread ? () => graphPrefs.setSpread(GRAPH_DEFAULTS.spread) : undefined}
    >
      {#snippet control()}
        <div class="slider-cell">
          <input
            type="range"
            min={SCALE_RANGE.min}
            max={SCALE_RANGE.max}
            step={SCALE_RANGE.step}
            value={graphPrefs.spread}
            oninput={(e) => graphPrefs.setSpread(+e.currentTarget.value)}
            aria-label="Spread"
          />
          <span class="slider-val">{graphPrefs.spread.toFixed(1)}</span>
        </div>
      {/snippet}
    </PrefRow>
    <SegmentedRow
      label="Focus depth"
      options={HOP_OPTIONS}
      value={String(graphPrefs.lensHops)}
      reset={graphPrefs.lensHops !== GRAPH_DEFAULTS.lensHops
        ? () => graphPrefs.setLensHops(GRAPH_DEFAULTS.lensHops)
        : undefined}
      onchange={(v) => graphPrefs.setLensHops(Number(v))}
    />
  </details>
</div>

<style>
  .graph-pane-settings {
    max-width: 560px;
  }
  .graph-pane-settings h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
</style>
