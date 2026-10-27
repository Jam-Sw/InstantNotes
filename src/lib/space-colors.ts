import { isSwatchName } from "$lib/themes/swatches";
import { SWATCH_VAR } from "$lib/themes/types";

export type MarkerMode = "color" | "flag" | "both";

export const MARKER_MODES: readonly MarkerMode[] = ["color", "flag", "both"];
export const MARKER_MODE_DEFAULT: MarkerMode = "color";
export const MARKER_MODE_KEY = "spaceMarker";

export function parseMarkerMode(value: unknown): MarkerMode {
  return value === "flag" || value === "both" || value === "color" ? value : MARKER_MODE_DEFAULT;
}

// What a marker draws for one space. A space's own flag switch adds the flag
// whatever the global mode is.
export function markerParts(mode: MarkerMode, spaceFlag: boolean): { disc: boolean; flag: boolean } {
  return { disc: mode !== "flag", flag: mode !== "color" || spaceFlag };
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const HEX_LOOSE_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Reads what a person typed into the Custom field: "#3a7", "3A7BFF" and
// "#3a7bff" all become the stored form "#rrggbb", anything else is null.
export function normalizeHex(input: string): string | null {
  const m = HEX_LOOSE_RE.exec(input.trim());
  if (!m) return null;
  const digits = m[1].toLowerCase();
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  return `#${full}`;
}

export function isStoredColor(value: unknown): value is string {
  return typeof value === "string" && (isSwatchName(value) || HEX_RE.test(value));
}

// A stored colour (a swatch name or "#rrggbb") as a CSS value. A swatch name
// resolves through the theme's --swatch-<name> variable, so switching theme
// recolours it; a custom hex stays as it is. Null for none or anything invalid.
export function cssColor(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (isSwatchName(stored)) return `var(${SWATCH_VAR[stored]})`;
  return HEX_RE.test(stored) ? stored : null;
}

export interface SliceLike {
  workspaceId: string;
  color: string;
  noteCount: number;
}

export function groupSlices<T extends SliceLike>(slices: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const s of slices) {
    if (s.noteCount <= 0 || !cssColor(s.color)) continue;
    const list = out.get(s.workspaceId);
    if (list) list.push(s);
    else out.set(s.workspaceId, [s]);
  }
  return out;
}

export interface Arc {
  color: string;
  start: number;
  end: number;
}

// Slice angles in degrees, clockwise from twelve o'clock. Each slice is sized
// by its note count; the biggest comes first so the pie reads the same every
// time. Slices of one colour merge.
export function sliceArcs(slices: readonly { color: string; noteCount: number }[]): Arc[] {
  const byColor = new Map<string, number>();
  for (const s of slices) {
    const css = cssColor(s.color);
    if (!css || s.noteCount <= 0) continue;
    byColor.set(css, (byColor.get(css) ?? 0) + s.noteCount);
  }
  const total = [...byColor.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = [...byColor.entries()].sort((a, b) => b[1] - a[1]);
  const arcs: Arc[] = [];
  let at = 0;
  for (const [color, count] of sorted) {
    const end = at + (count / total) * 360;
    arcs.push({ color, start: at, end });
    at = end;
  }
  arcs[arcs.length - 1].end = 360;
  return arcs;
}

function point(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

const fix = (n: number) => String(Math.round(n * 100) / 100);

// SVG path for a pie sector. A full turn is two half arcs, since one arc
// cannot start and end on the same point.
export function sectorPath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= 359.999) {
    const [x0, y0] = point(cx, cy, r, 0);
    const [x1, y1] = point(cx, cy, r, 180);
    return `M${fix(x0)} ${fix(y0)}A${r} ${r} 0 1 1 ${fix(x1)} ${fix(y1)}A${r} ${r} 0 1 1 ${fix(x0)} ${fix(y0)}Z`;
  }
  const [x0, y0] = point(cx, cy, r, start);
  const [x1, y1] = point(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M${cx} ${cy}L${fix(x0)} ${fix(y0)}A${r} ${r} 0 ${large} 1 ${fix(x1)} ${fix(y1)}Z`;
}
