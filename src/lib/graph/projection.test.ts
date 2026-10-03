import { describe, expect, it } from "vitest";
import { FRONT, PITCH_LIMIT, centroid, projector, turn } from "./projection";

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
