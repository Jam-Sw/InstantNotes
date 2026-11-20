import { describe, expect, it } from "vitest";
import { Figures } from "$lib/calc/plot";
import { compileLine, type Scope, type Value } from "$lib/calc/engine";
import { FRONT } from "./projection";
import { camera2d, camera3d, niceLimits, prepare, scene2d, scene3d, tickLabel, ticks } from "./figure";

function figure(src: string) {
  const draw = new Figures();
  const vars = new Map<string, Value>();
  const scope: Scope = { draw, get: (n) => vars.get(n), set: (n, v) => void vars.set(n, v) };
  for (const st of compileLine(src)) st.run(scope);
  return prepare(draw.list()[0]);
}

const size = { width: 480, height: 300 };
const numbers = (s: string) => s.split(/[ ,]/).map(Number);

describe("limits and ticks", () => {
  it("rounds limits out to tick steps", () => {
    expect(niceLimits([Float64Array.of(0, 2 * Math.PI)])).toEqual({ min: 0, max: 7 });
    expect(niceLimits([Float64Array.of(-0.93, 0.98)])).toEqual({ min: -1, max: 1 });
  });

  it("pads a flat range and ignores non-finite values", () => {
    expect(niceLimits([Float64Array.of(5, 5, NaN)])).toEqual({ min: 4, max: 6 });
    expect(niceLimits([Float64Array.of(NaN)])).toEqual({ min: 0, max: 1 });
    expect(niceLimits([])).toEqual({ min: 0, max: 1 });
  });

  it("makes clean tick values", () => {
    expect(ticks({ min: 0, max: 1 })).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks({ min: -1, max: 1 }).map(tickLabel)).toEqual(["-1", "-0.5", "0", "0.5", "1"]);
  });
});

describe("scene2d", () => {
  it("draws one stroke per series inside the plot area", () => {
    const fig = figure("plot([1 2 3], [4 5 6], [1 2 3], [6 5 4])");
    const s = scene2d(fig, size, camera2d());
    expect(s.lines).toHaveLength(2);
    const clip = s.clip!;
    const [a, , , d, e, f] = numbers(s.lineTransform.slice(7, -1));
    for (const line of s.lines) {
      const v = numbers(line.points);
      for (let i = 0; i < v.length; i += 2) {
        const x = a * v[i] + e;
        const y = d * v[i + 1] + f;
        expect(x).toBeGreaterThanOrEqual(clip.x - 1e-6);
        expect(x).toBeLessThanOrEqual(clip.x + clip.width + 1e-6);
        expect(y).toBeGreaterThanOrEqual(clip.y - 1e-6);
        expect(y).toBeLessThanOrEqual(clip.y + clip.height + 1e-6);
      }
    }
  });

  it("breaks a line at NaN", () => {
    const fig = figure("plot([1 2 NaN 4 5])");
    expect(scene2d(fig, size, camera2d()).lines).toHaveLength(2);
  });

  it("re-ticks the visible range when zoomed", () => {
    const fig = figure("plot([0 10], [0 10])");
    const before = scene2d(fig, size, camera2d()).labels.length;
    const zoomed = scene2d(fig, size, { x: -size.width, y: -size.height, k: 3 });
    expect(zoomed.labels.length).toBeGreaterThan(0);
    expect(zoomed.labels.map((l) => l.text)).not.toEqual(
      scene2d(fig, size, camera2d()).labels.map((l) => l.text),
    );
    expect(before).toBeGreaterThan(0);
  });

  it("keeps line points across pan and zoom and moves them by transform", () => {
    const fig = figure("plot([0 10], [0 10])");
    const a = scene2d(fig, size, camera2d());
    const b = scene2d(fig, size, { x: 40, y: -20, k: 2 });
    expect(b.lines[0]).toBe(a.lines[0]);
    expect(b.lineTransform).not.toBe(a.lineTransform);
  });

  it("draws an empty figure as a frame", () => {
    const draw = new Figures();
    draw.figure(1);
    const s = scene2d(prepare(draw.list()[0]), size, camera2d());
    expect(s.lines).toEqual([]);
    expect(s.frame.length).toBeGreaterThan(0);
  });
});

describe("scene3d", () => {
  it("draws the twelve box edges and finite, fogged strokes", () => {
    const fig = figure("t = linspace(0, 10, 300); plot3(sin(t), cos(t), t)");
    const { orbit, view } = camera3d(size);
    const s = scene3d(fig, size, orbit, view);
    expect(s.frame).toHaveLength(12);
    expect(s.lines.length).toBeGreaterThan(1);
    for (const line of s.lines) {
      expect(numbers(line.points).every(Number.isFinite)).toBe(true);
      expect(line.opacity).toBeGreaterThan(0);
      expect(line.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("joins chunks so the line has no gaps", () => {
    const fig = figure("plot3(1:200, 1:200, 1:200)");
    const { orbit, view } = camera3d(size);
    const lines = scene3d(fig, size, orbit, view).lines;
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1].points.split(" ");
      expect(lines[i].points.split(" ")[0]).toBe(prev[prev.length - 1]);
    }
  });

  it("puts z up and x right from the front", () => {
    const fig = figure("plot3([0 1], [0 0], [0 0]), hold on, plot3([0 0], [0 0], [0 1])");
    const view = { x: 0, y: 0, k: 1 };
    const [xLine, zLine] = scene3d(fig, size, FRONT, view).lines.map((l) => numbers(l.points));
    expect(xLine[2]).toBeGreaterThan(xLine[0]);
    expect(zLine[3]).toBeLessThan(zLine[1]);
  });
});
