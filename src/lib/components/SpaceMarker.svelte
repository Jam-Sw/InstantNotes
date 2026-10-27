<script lang="ts">
  import { cssColor, markerParts, sectorPath, sliceArcs, type MarkerMode } from "$lib/space-colors";

  let {
    color = null,
    flag = false,
    slices = [],
    mode = "color",
    size = 14,
  }: {
    color?: string | null;
    flag?: boolean;
    slices?: readonly { color: string; noteCount: number }[];
    mode?: MarkerMode;
    size?: number;
  } = $props();

  const C = 7;
  const R = 6;
  const HOLE = 3.3;

  const parts = $derived(markerParts(mode, flag));
  const fill = $derived(cssColor(color));
  const arcs = $derived(sliceArcs(slices));
  const pennant = $derived(fill ?? arcs[0]?.color ?? null);
</script>

<span class="marker" aria-hidden="true">
  {#if parts.disc}
    <svg class="disc" viewBox="0 0 14 14" width={size} height={size}>
      {#if arcs.length > 0}
        {#each arcs as arc (arc.start)}
          <path class="slice" d={sectorPath(C, C, R, arc.start, arc.end)} style:fill={arc.color} />
        {/each}
        {#if fill}
          <circle class="centre" cx={C} cy={C} r={HOLE} style:fill={fill} />
        {/if}
      {:else if fill}
        <circle class="solid" cx={C} cy={C} r={R - 0.5} style:fill={fill} />
      {:else}
        <circle class="neutral" cx={C} cy={C} r={R - 1} />
      {/if}
    </svg>
  {/if}
  {#if parts.flag}
    <svg class="flag" viewBox="0 0 14 14" width={size} height={size}>
      <rect class="base" x="1.6" y="11.4" width="7.6" height="1.7" rx="0.5" />
      <rect class="pole" x="4.4" y="1" width="1.1" height="10.6" rx="0.4" />
      <path
        class="pennant"
        class:neutral={!pennant}
        d="M5.5 1.4L12.6 4.6L5.5 7.8Z"
        style:fill={pennant ?? undefined}
      />
    </svg>
  {/if}
</span>

<style>
  .marker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    vertical-align: middle;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .slice {
    stroke: color-mix(in srgb, var(--bg) 60%, transparent);
    stroke-width: 0.5;
    stroke-linejoin: round;
  }
  .centre,
  .solid {
    stroke: color-mix(in srgb, var(--text) 14%, transparent);
    stroke-width: 0.5;
  }
  .neutral {
    fill: none;
    stroke: var(--text-tertiary);
    stroke-width: 1.3;
  }
  .base,
  .pole {
    fill: color-mix(in srgb, var(--text) 82%, var(--bg));
  }
  .pennant {
    stroke: color-mix(in srgb, var(--text) 30%, transparent);
    stroke-width: 0.5;
    stroke-linejoin: round;
  }
  .pennant.neutral {
    fill: var(--text-tertiary);
    stroke: none;
  }
</style>
