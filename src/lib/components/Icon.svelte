<script lang="ts" module>
  const ICONS = {
    image: [
      "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
      "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
      "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 20",
    ],
    devices: [
      "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M11 18h2",
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
    undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
    redo: ["m15 14 5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
    heading: ["M6 4v16", "M18 4v16", "M6 12h12"],
    bold: ["M7 4h6.5a3.5 3.5 0 0 1 0 7H7z", "M7 11h7.5a3.5 3.5 0 0 1 0 7H7z"],
    italic: ["M10 4h7", "M7 20h7", "m14 4-4 16"],
    strike: [
      "M4 12h16",
      "M16.5 7c-.8-1.8-2.5-3-4.5-3-2.5 0-4.5 1.5-4.5 3.5S9.5 11 12 11",
      "M7.5 17c.8 1.8 2.5 3 4.5 3 2.5 0 4.5-1.5 4.5-3.5S14.5 13 12 13",
    ],
    code: ["m9 8-4 4 4 4", "m15 8 4 4-4 4"],
    quote: [
      "M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4",
      "M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6a4 4 0 0 1-4 4",
    ],
    list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
    task: ["M4 5h6v6H4z", "m5.8 8.2 1.4 1.4L9.8 7", "M13 8h7", "M4 14h6v6H4z", "M13 17h7"],
    link: [
      "M9.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1",
      "M14.5 10.5a3.5 3.5 0 0 0-5 0L7 13a3.5 3.5 0 0 0 5 5l1-1",
    ],
    markdown: ["M3 5h18v14H3z", "M7 15V9l2.5 3L12 9v6", "m15 12 2 2 2-2", "M17 9v5"],
    menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
    back: ["m15 5-7 7 7 7"],
    command: ["M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"],
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
