<script lang="ts" module>
  // The app's action icons: one 24-unit grid, one stroke, drawn in the colour
  // of the text around them. Each is a list of path data, so adding an icon is
  // adding a line here.
  const ICONS = {
    image: [
      "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
      "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
      "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 20",
    ],
    format: ["M4 7V5h16v2", "M12 5v14", "M9 19h6"],
    sticky: [
      "M5 3h10l6 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M15 3v5a1 1 0 0 0 1 1h5",
    ],
    pin: [
      "M12 17v5",
      "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    ],
    archive: [
      "M4 4h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
      "M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8",
      "M10 12h4",
    ],
    trash: [
      "M3 6h18",
      "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2",
      "m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
      "M10 11v6",
      "M14 11v6",
    ],
    restore: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
  } as const;

  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each ICONS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
