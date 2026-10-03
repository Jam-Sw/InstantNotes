// How the Graph's three dimensions reach a flat screen: the layout turned by
// an orbit (yaw about the vertical axis, then pitch about the horizontal one)
// around a pivot, then seen in perspective from in front of it. The result
// stays in layout units, so the view's own pan and zoom apply on top as they
// always have.

/** How the graph is turned, in radians. Zero for both is the front view. */
export interface Orbit {
  yaw: number;
  pitch: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A point as drawn: where, how much perspective enlarges or shrinks it,
 *  and how far behind the pivot it sits (larger is further away). */
export interface Projected {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

export const FRONT: Orbit = { yaw: 0, pitch: 0 };

/**
 * Pitch stops short of straight up or down, so "up" never flips.
 * @internal
 */
export const PITCH_LIMIT = 1.4;

/** The eye's distance in front of the pivot, in layout units. A node this
 *  far behind the pivot is drawn at half size; one this far in front would
 *  be at the eye, so nearness is capped short of it. */
const EYE = 900;
const NEAREST = -EYE * 0.75;

/** The mean position: the point the graph turns around. */
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

/** A projection for one orbit and pivot, to apply to every node of a frame. */
export function projector(orbit: Orbit, pivot: Point3): (p: Point3) => Projected {
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  return (p) => {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    const dz = p.z - pivot.z;
    const x1 = dx * cy + dz * sy;
    const z1 = dz * cy - dx * sy;
    const y2 = dy * cp - z1 * sp;
    const depth = Math.max(NEAREST, dy * sp + z1 * cp);
    const scale = EYE / (EYE + depth);
    return { x: pivot.x + x1 * scale, y: pivot.y + y2 * scale, scale, depth };
  };
}

/** The orbit after a drag of (dx, dy) pixels, or an arrow key's step. */
export function turn(orbit: Orbit, dx: number, dy: number): Orbit {
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, orbit.pitch + dy * 0.008));
  return { yaw: orbit.yaw + dx * 0.008, pitch };
}
