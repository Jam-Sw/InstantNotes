import type { Figure, Series } from "$lib/calc/plot";
import { centreView, fog, projectInto, projector, type Orbit, type Point3, type Projections, type View } from "./projection";

const HALF = 150;
const ISO: Orbit = { yaw: -0.6545, pitch: 0.5236 };
const COLORS = ["#0072bd", "#d95319", "#edb120", "#7e2f8e", "#77ac30", "#4dbeee", "#a2142f"];

const MARGIN = { left: 52, right: 16, top: 14, bottom: 30 };
const CHUNK = 64;
const TICK = 5;
const LABEL_GAP = 16;
const ORIGIN: Point3 = { x: 0, y: 0, z: 0 };

interface Limits {
  min: number;
  max: number;
}

export interface Size {
  width: number;
  height: number;
}

interface Stroke {
  points: string;
  color: string;
  opacity: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
}

export interface Scene {
  clip: { x: number; y: number; width: number; height: number } | null;
  frame: Stroke[];
  lines: Stroke[];
  lineTransform: string;
  labels: Label[];
}

interface Track {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  runs: [number, number][];
  color: string;
  out: Projections;
}

export interface Prepared {
  readonly figure: Figure;
  readonly lim: readonly [Limits, Limits, Limits];
  readonly flat: readonly Stroke[];
  readonly tracks: readonly Track[];
}

function extent(arrays: readonly Float64Array[]): Limits {
  let min = Infinity;
  let max = -Infinity;
  for (const a of arrays) {
    for (const v of a) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 1e-6);
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

function tickStep(lim: Limits, count = 5): number {
  const raw = (lim.max - lim.min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  return Number.isFinite(step) && step > 0 ? step : NaN;
}

export function ticks(lim: Limits, count = 5): number[] {
  const step = tickStep(lim, count);
  const out: number[] = [];
  if (Number.isNaN(step) || (lim.max - lim.min) / step > 50) return out;
  const eps = step * 1e-9;
  for (let i = Math.ceil((lim.min - eps) / step); i * step <= lim.max + eps; i++) {
    out.push(Number((i * step).toPrecision(12)));
  }
  return out;
}

export function niceLimits(arrays: readonly Float64Array[]): Limits {
  const lim = extent(arrays);
  const step = tickStep(lim);
  const eps = step * 1e-9;
  const nice = {
    min: Number((Math.floor((lim.min + eps) / step) * step).toPrecision(12)),
    max: Number((Math.ceil((lim.max - eps) / step) * step).toPrecision(12)),
  };
  return Number.isFinite(nice.max - nice.min) && nice.max > nice.min ? nice : lim;
}

export function tickLabel(v: number): string {
  return String(Number(v.toPrecision(6)));
}

const UNIT = 1e6;

function pick(series: readonly Series[], axis: "x" | "y" | "z"): Float64Array[] {
  return series.map((s) => s[axis]).filter((a): a is Float64Array => a !== null);
}

function runs(n: number, ok: (i: number) => boolean, max = Infinity): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const good = i < n && ok(i);
    if (good && start < 0) start = i;
    if (start >= 0 && (!good || i - start >= max)) {
      if (i - start >= 1) out.push([start, i]);
      start = good ? i - 1 : -1;
    }
  }
  return out;
}

function unit(v: number, l: Limits): number {
  return (v - l.min) / (l.max - l.min);
}

function flatStrokes(fig: Figure, xl: Limits, yl: Limits): Stroke[] {
  const out: Stroke[] = [];
  fig.series.forEach((s, i) => {
    const color = COLORS[i % COLORS.length];
    const n = s.x.length;
    const u = new Float64Array(n);
    const v = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      u[j] = Math.round(unit(s.x[j], xl) * UNIT);
      v[j] = Math.round(unit(s.y[j], yl) * UNIT);
    }
    for (const [a, b] of runs(n, (j) => Number.isFinite(u[j] + v[j]))) {
      let points = "";
      for (let j = a; j < b; j++) points += `${j === a ? "" : " "}${u[j]},${v[j]}`;
      out.push({ points, color, opacity: 1 });
    }
  });
  return out;
}

function tracksOf(fig: Figure, lim: readonly [Limits, Limits, Limits]): Track[] {
  const w = (v: number, l: Limits) => (unit(v, l) * 2 - 1) * HALF;
  return fig.series.map((s, i) => {
    const n = s.x.length;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);
    const good = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      x[j] = w(s.x[j], lim[0]);
      y[j] = -w(s.z ? s.z[j] : 0, lim[2]);
      z[j] = w(s.y[j], lim[1]);
      good[j] = Number.isFinite(x[j] + y[j] + z[j]) ? 1 : 0;
    }
    const ok = (j: number) => good[j] === 1;
    return {
      x,
      y,
      z,
      runs: runs(n, ok, CHUNK),
      color: COLORS[i % COLORS.length],
      out: { x: new Float64Array(n), y: new Float64Array(n), depth: new Float64Array(n) },
    };
  });
}

export function prepare(fig: Figure): Prepared {
  const lim = [niceLimits(pick(fig.series, "x")), niceLimits(pick(fig.series, "y")), niceLimits(pick(fig.series, "z"))] as const;
  return fig.dims === 3
    ? { figure: fig, lim, flat: [], tracks: tracksOf(fig, lim) }
    : { figure: fig, lim, flat: flatStrokes(fig, lim[0], lim[1]), tracks: [] };
}

export function camera2d(): View {
  return { x: 0, y: 0, k: 1 };
}

export function camera3d(size: Size): { orbit: Orbit; view: View } {
  const project = projector(ISO, ORIGIN);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [-HALF, HALF]) {
    for (const y of [-HALF, HALF]) {
      for (const z of [-HALF, HALF]) {
        const p = project({ x, y, z });
        xs.push(p.x);
        ys.push(p.y);
      }
    }
  }
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const pad = LABEL_GAP + 20;
  const k = Math.max(
    0.05,
    Math.min((size.width - 2 * pad) / (box.x1 - box.x0), (size.height - 2 * pad) / (box.y1 - box.y0)),
  );
  const on = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  return { orbit: ISO, view: centreView(k, on, size.width, size.height) };
}

export function scene2d(prep: Prepared, size: Size, view: View): Scene {
  const left = MARGIN.left;
  const top = MARGIN.top;
  const right = Math.max(left + 1, size.width - MARGIN.right);
  const bottom = Math.max(top + 1, size.height - MARGIN.bottom);
  const [xl, yl] = prep.lim;
  const sx = (v: number) => view.x + (left + unit(v, xl) * (right - left)) * view.k;
  const sy = (v: number) => view.y + (bottom - unit(v, yl) * (bottom - top)) * view.k;
  const ux = (px: number) => xl.min + (((px - view.x) / view.k - left) / (right - left)) * (xl.max - xl.min);
  const uy = (py: number) => yl.min + ((bottom - (py - view.y) / view.k) / (bottom - top)) * (yl.max - yl.min);
  const seen = { x: { min: ux(left), max: ux(right) }, y: { min: uy(bottom), max: uy(top) } };

  const frame: Stroke[] = [
    { points: `${left},${top} ${right},${top} ${right},${bottom} ${left},${bottom} ${left},${top}`, color: "", opacity: 1 },
  ];
  const labels: Label[] = [];
  for (const t of ticks(seen.x)) {
    const x = sx(t);
    frame.push({ points: `${x.toFixed(1)},${bottom} ${x.toFixed(1)},${bottom - TICK}`, color: "", opacity: 1 });
    labels.push({ x, y: bottom + LABEL_GAP, text: tickLabel(t), anchor: "middle" });
  }
  for (const t of ticks(seen.y)) {
    const y = sy(t);
    frame.push({ points: `${left},${y.toFixed(1)} ${left + TICK},${y.toFixed(1)}`, color: "", opacity: 1 });
    labels.push({ x: left - 6, y: y + 4, text: tickLabel(t), anchor: "end" });
  }
  const a = ((right - left) * view.k) / UNIT;
  const d = (-(bottom - top) * view.k) / UNIT;
  const lineTransform = `matrix(${a} 0 0 ${d} ${view.x + left * view.k} ${view.y + bottom * view.k})`;
  return {
    clip: { x: left, y: top, width: right - left, height: bottom - top },
    frame,
    lines: prep.flat as Stroke[],
    lineTransform,
    labels,
  };
}

export function scene3d(prep: Prepared, size: Size, orbit: Orbit, view: View): Scene {
  const lim = prep.lim;
  const w = (v: number, l: Limits) => (unit(v, l) * 2 - 1) * HALF;
  const world = (x: number, y: number, z: number): Point3 => ({
    x: w(x, lim[0]),
    y: -w(z, lim[2]),
    z: w(y, lim[1]),
  });
  const project = projector(orbit, ORIGIN);
  const screen = (p: Point3) => {
    const q = project(p);
    return { x: view.x + q.x * view.k, y: view.y + q.y * view.k, depth: q.depth };
  };
  const centre = screen(ORIGIN);
  const corner = (i: number, j: number, k: number) =>
    screen({ x: i ? HALF : -HALF, y: k ? -HALF : HALF, z: j ? HALF : -HALF });

  const frame: Stroke[] = [];
  const edge = (a: ReturnType<typeof screen>, b: ReturnType<typeof screen>) =>
    frame.push({
      points: `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
      color: "",
      opacity: fog((a.depth + b.depth) / 2),
    });
  for (const u of [0, 1]) {
    for (const v of [0, 1]) {
      edge(corner(0, u, v), corner(1, u, v));
      edge(corner(u, 0, v), corner(u, 1, v));
      edge(corner(u, v, 0), corner(u, v, 1));
    }
  }

  const labels: Label[] = [];
  const nearer = (a: number, b: number) => (a <= b ? 0 : 1);
  const xj = nearer(corner(0, 0, 0).depth, corner(0, 1, 0).depth);
  const yi = nearer(corner(0, 0, 0).depth, corner(1, 0, 0).depth);
  const verticals = [0, 1].flatMap((i) => [0, 1].map((j) => ({ i, j, x: corner(i, j, 0).x })));
  const zc = verticals.reduce((a, b) => (b.x < a.x ? b : a));
  const place = (at: ReturnType<typeof screen>, text: string, nudge: { x: number; y: number }) => {
    const dx = nudge.x;
    const dy = nudge.y;
    const len = Math.hypot(dx, dy) || 1;
    const x = at.x + (dx / len) * LABEL_GAP;
    const y = at.y + (dy / len) * LABEL_GAP + 4;
    labels.push({ x, y, text, anchor: Math.abs(dx / len) < 0.35 ? "middle" : dx < 0 ? "end" : "start" });
  };
  const along = (axis: 0 | 1 | 2, t: number) => {
    const p = world(
      axis === 0 ? t : yi ? lim[0].max : lim[0].min,
      axis === 1 ? t : xj ? lim[1].max : lim[1].min,
      axis === 2 ? t : lim[2].min,
    );
    if (axis === 2) {
      p.x = zc.i ? HALF : -HALF;
      p.z = zc.j ? HALF : -HALF;
    }
    return screen(p);
  };
  for (const axis of [0, 1, 2] as const) {
    for (const t of ticks(lim[axis], 4)) {
      if (axis === 2 && t === lim[2].min) continue;
      const at = along(axis, t);
      const nudge = axis === 2 ? { x: -1, y: 0 } : { x: at.x - centre.x, y: at.y - centre.y };
      place(at, tickLabel(t), nudge);
    }
  }

  const lines: Stroke[] = [];
  for (const track of prep.tracks) {
    const { out } = track;
    projectInto(orbit, ORIGIN, track.x, track.y, track.z, out);
    for (const [a, b] of track.runs) {
      let points = "";
      let depth = 0;
      let px = NaN;
      let py = NaN;
      for (let j = a; j < b; j++) {
        depth += out.depth[j];
        const x = Math.round((view.x + out.x[j] * view.k) * 10);
        const y = Math.round((view.y + out.y[j] * view.k) * 10);
        if (x === px && y === py && j < b - 1) continue;
        points += `${j === a ? "" : " "}${x},${y}`;
        px = x;
        py = y;
      }
      lines.push({ points, color: track.color, opacity: fog(depth / (b - a)) });
    }
  }
  return { clip: null, frame, lines, lineTransform: "scale(0.1)", labels };
}
