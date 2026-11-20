export interface Orbit {
  yaw: number;
  pitch: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

export const FRONT: Orbit = { yaw: 0, pitch: 0 };

export const PITCH_LIMIT = 1.4;

const EYE = 900;
const NEAREST = -EYE * 0.75;

export function centroid(points: readonly Point3[]): Point3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}

function core(orbit: Orbit, pivot: Point3): (x: number, y: number, z: number, out: Projected) => void {
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  return (x, y, z, out) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    const dz = z - pivot.z;
    const x1 = dx * cy + dz * sy;
    const z1 = dz * cy - dx * sy;
    const y2 = dy * cp - z1 * sp;
    const depth = Math.max(NEAREST, dy * sp + z1 * cp);
    const scale = EYE / (EYE + depth);
    out.x = pivot.x + x1 * scale;
    out.y = pivot.y + y2 * scale;
    out.scale = scale;
    out.depth = depth;
  };
}

export function projector(orbit: Orbit, pivot: Point3): (p: Point3) => Projected {
  const run = core(orbit, pivot);
  return (p) => {
    const out = { x: 0, y: 0, scale: 0, depth: 0 };
    run(p.x, p.y, p.z, out);
    return out;
  };
}

export interface Projections {
  x: Float64Array;
  y: Float64Array;
  depth: Float64Array;
}

export function projectInto(
  orbit: Orbit,
  pivot: Point3,
  xs: Float64Array,
  ys: Float64Array,
  zs: Float64Array,
  out: Projections,
): void {
  const run = core(orbit, pivot);
  const p = { x: 0, y: 0, scale: 0, depth: 0 };
  for (let i = 0; i < xs.length; i++) {
    run(xs[i], ys[i], zs[i], p);
    out.x[i] = p.x;
    out.y[i] = p.y;
    out.depth[i] = p.depth;
  }
}

export function turn(orbit: Orbit, dx: number, dy: number): Orbit {
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, orbit.pitch + dy * 0.008));
  return { yaw: orbit.yaw + dx * 0.008, pitch };
}

export interface View {
  x: number;
  y: number;
  k: number;
}

interface Spot {
  x: number;
  y: number;
}

export const ZOOM = { min: 0.2, max: 4 };

const FOG_NEAR = -200;
const FOG_FAR = 400;
export const FOG_FLOOR = 0.35;
const WHEEL_NOTCH = 40;
const MAC_WHEEL_STEP = 4.000244140625;

export function clampZoom(k: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, k));
}

export function fog(depth: number): number {
  const t = Math.min(1, Math.max(0, (FOG_FAR - depth) / (FOG_FAR - FOG_NEAR)));
  return FOG_FLOOR + (1 - FOG_FLOOR) * t;
}

export function reach(points: readonly Point3[], centre: Point3): number {
  let r = 0;
  for (const p of points) r = Math.max(r, Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z));
  return r;
}

export function ring(
  centre: Point3,
  radius: number,
  plane: "upright" | "ground",
  segments = 72,
): Point3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    const u = Math.cos(a) * radius;
    const v = Math.sin(a) * radius;
    return plane === "upright"
      ? { x: centre.x + u, y: centre.y + v, z: centre.z }
      : { x: centre.x + u, y: centre.y, z: centre.z + v };
  });
}

export type WheelKind = "zoom" | "pan";

export function wheelKind(
  e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">,
): WheelKind {
  if (e.ctrlKey || e.deltaMode !== 0) return "zoom";
  if (e.deltaX !== 0) return "pan";
  const d = Math.abs(e.deltaY);
  return d >= WHEEL_NOTCH || d % MAC_WHEEL_STEP === 0 ? "zoom" : "pan";
}

export function zoomAt(view: View, k: number, px: number, py: number): View {
  return { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
}

export function pinch(view: View, before: [Spot, Spot], after: [Spot, Spot]): View {
  const span = (p: [Spot, Spot]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
  const mid = (p: [Spot, Spot]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const m0 = mid(before);
  const m1 = mid(after);
  const zoomed = zoomAt(view, clampZoom((view.k * span(after)) / span(before)), m0.x, m0.y);
  return { ...zoomed, x: zoomed.x + m1.x - m0.x, y: zoomed.y + m1.y - m0.y };
}

export function centreView(k: number, on: Spot, width: number, height: number): View {
  return { k, x: width / 2 - on.x * k, y: height / 2 - on.y * k };
}

export function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function mix3(a: Point3, b: Point3, t: number): Point3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function mixView(a: View, b: View, t: number): View {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t };
}
