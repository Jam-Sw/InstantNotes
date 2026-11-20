import { describe, expect, it } from "vitest";
import {
  FOG_FLOOR,
  FRONT,
  PITCH_LIMIT,
  ZOOM,
  centreView,
  centroid,
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
} from "./projection";

const pivot = { x: 10, y: 20, z: 0 };

describe("projector", () => {
  it("draws a point on the pivot's plane where it is, from the front", () => {
    const p = projector(FRONT, pivot)({ x: 110, y: -30, z: 0 });
    expect(p).toEqual({ x: 110, y: -30, scale: 1, depth: 0 });
  });

  it("draws what is further away smaller and closer to the pivot", () => {
    const project = projector(FRONT, pivot);
    const near = project({ x: 110, y: 20, z: -200 });
    const far = project({ x: 110, y: 20, z: 200 });
    expect(near.scale).toBeGreaterThan(1);
    expect(far.scale).toBeLessThan(1);
    expect(far.depth).toBeGreaterThan(near.depth);
    expect(Math.abs(far.x - pivot.x)).toBeLessThan(Math.abs(near.x - pivot.x));
  });

  it("turned a quarter round, shows depth across the screen", () => {
    const p = projector({ yaw: Math.PI / 2, pitch: 0 }, pivot)({ x: 10, y: 20, z: 100 });
    expect(p.x).toBeGreaterThan(pivot.x + 50);
    expect(p.depth).toBeCloseTo(0);
  });

  it("never lets a point reach the eye", () => {
    const p = projector(FRONT, pivot)({ x: 10, y: 20, z: -1e6 });
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.scale).toBeLessThanOrEqual(4);
  });
});

describe("turn", () => {
  it("yaws with a sideways drag and pitches with an upright one", () => {
    const o = turn(FRONT, 100, -50);
    expect(o.yaw).toBeGreaterThan(0);
    expect(o.pitch).toBeLessThan(0);
  });

  it("stops pitch short of upside down", () => {
    expect(turn(FRONT, 0, 1e6).pitch).toBe(PITCH_LIMIT);
    expect(turn(FRONT, 0, -1e6).pitch).toBe(-PITCH_LIMIT);
  });
});

describe("centroid", () => {
  it("is the mean position, and the origin for nothing", () => {
    expect(centroid([{ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: -6 }])).toEqual({ x: 1, y: 2, z: -3 });
    expect(centroid([])).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("fog", () => {
  it("leaves what is near at full strength and fades what is far, never to nothing", () => {
    expect(fog(-500)).toBe(1);
    expect(fog(0)).toBeGreaterThan(fog(200));
    expect(fog(1e6)).toBe(FOG_FLOOR);
  });
});

describe("ring", () => {
  it("lies in the world, the same points whichever way the view turns", () => {
    const points = ring(pivot, 50, "ground", 4);
    expect(points).toHaveLength(5);
    for (const p of points) {
      expect(p.y).toBe(pivot.y);
      expect(Math.hypot(p.x - pivot.x, p.z - pivot.z)).toBeCloseTo(50);
    }
    const upright = ring(pivot, 50, "upright", 4);
    for (const p of upright) expect(p.z).toBe(pivot.z);
  });

  it("reaches the farthest point from the centre", () => {
    expect(reach([{ x: 13, y: 24, z: 0 }, { x: 10, y: 20, z: 12 }], pivot)).toBe(12);
    expect(reach([], pivot)).toBe(0);
  });
});

describe("wheelKind", () => {
  const wheel = (deltaY: number, more: Partial<WheelEvent> = {}) => ({
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: false,
    deltaY,
    ...more,
  });

  it("zooms for a mouse wheel notch and a pinch", () => {
    expect(wheelKind(wheel(100))).toBe("zoom");
    expect(wheelKind(wheel(-120))).toBe("zoom");
    expect(wheelKind(wheel(3, { deltaMode: 1 }))).toBe("zoom");
    expect(wheelKind(wheel(MAC_STEP * 3))).toBe("zoom");
    expect(wheelKind(wheel(2.5, { ctrlKey: true }))).toBe("zoom");
  });

  it("pans for two fingers on a trackpad", () => {
    expect(wheelKind(wheel(6.5))).toBe("pan");
    expect(wheelKind(wheel(120, { deltaX: 4 }))).toBe("pan");
  });
});

const MAC_STEP = 4.000244140625;

describe("zoomAt and pinch", () => {
  const view = { x: 100, y: 50, k: 1 };

  it("keeps the point under the pointer where it is", () => {
    const next = zoomAt(view, 2, 300, 250);
    expect(300 - next.x).toBeCloseTo((300 - view.x) * 2);
    expect(250 - next.y).toBeCloseTo((250 - view.y) * 2);
  });

  it("zooms by how far the fingers spread and pans by where they move", () => {
    const next = pinch(
      view,
      [{ x: 200, y: 200 }, { x: 300, y: 200 }],
      [{ x: 160, y: 220 }, { x: 360, y: 220 }],
    );
    expect(next.k).toBe(2);
    const graphX = (250 - view.x) / view.k;
    expect(next.x + graphX * next.k).toBeCloseTo(260);
    expect(next.y + ((200 - view.y) / view.k) * next.k).toBeCloseTo(220);
  });

  it("never zooms past the limits", () => {
    const far = pinch(view, [{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    expect(far.k).toBe(ZOOM.max);
  });
});

describe("centreView", () => {
  it("puts the point in the middle of the view", () => {
    const v = centreView(2, { x: 30, y: -10 }, 800, 600);
    expect(v.x + 30 * v.k).toBe(400);
    expect(v.y - 10 * v.k).toBe(300);
  });
});

describe("ease and mix", () => {
  it("starts and ends where asked", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(mix3({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
    expect(mixView({ x: 0, y: 0, k: 1 }, { x: 10, y: 10, k: 3 }, 0.5)).toEqual({ x: 5, y: 5, k: 2 });
  });
});
