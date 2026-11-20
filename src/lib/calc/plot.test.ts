import { describe, expect, it } from "vitest";
import { CalcError, compileLine, type Scope, type Value } from "./engine";
import { Figures, MAX_FIGURES, MAX_POINTS, parseLineSpec } from "./plot";

function env(draw?: Figures): Scope {
  const vars = new Map<string, Value>();
  return { draw, get: (n) => vars.get(n), set: (n, v) => void vars.set(n, v) };
}

function go(src: string, scope: Scope): void {
  for (const st of compileLine(src)) st.run(scope);
}

function setup(): { f: Figures; s: Scope } {
  const f = new Figures();
  return { f, s: env(f) };
}

const arr = (a: Float64Array): number[] => Array.from(a);

describe("Figures", () => {
  it("creates figure 1 on first plot", () => {
    const { f, s } = setup();
    go("plot([1 2 3])", s);
    const [fig] = f.list();
    expect(fig.id).toBe(1);
    expect(fig.dims).toBe(2);
    expect(arr(fig.series[0].x)).toEqual([1, 2, 3]);
  });

  it("numbers new figures and switches with figure(n)", () => {
    const { f, s } = setup();
    go("figure; plot([1 2]); figure; plot([3 4]); figure(1); plot([5 6])", s);
    const list = f.list();
    expect(list.map((g) => g.id)).toEqual([1, 2]);
    expect(arr(list[0].series[0].y)).toEqual([5, 6]);
    expect(arr(list[1].series[0].y)).toEqual([3, 4]);
  });

  it("keeps empty figures", () => {
    const { f, s } = setup();
    go("figure(3)", s);
    expect(f.list()).toMatchObject([{ id: 3, dims: 2, series: [] }]);
  });

  it("replaces with hold off and appends with hold on", () => {
    const { f, s } = setup();
    go("plot([1 2]); plot([3 4])", s);
    expect(f.list()[0].series).toHaveLength(1);
    go("hold on; plot([5 6])", s);
    expect(f.list()[0].series).toHaveLength(2);
    go("hold off; plot([7 8])", s);
    expect(f.list()[0].series).toHaveLength(1);
  });

  it("toggles hold with a bare hold and turns it on with hold all", () => {
    const { f, s } = setup();
    go("plot([1 2]); hold; plot([3 4])", s);
    expect(f.list()[0].series).toHaveLength(2);
    go("hold; plot([5 6])", s);
    expect(f.list()[0].series).toHaveLength(1);
    go("hold all, plot([7 8])", s);
    expect(f.list()[0].series).toHaveLength(2);
  });

  it("keeps hold per figure", () => {
    const { f, s } = setup();
    go("hold on; plot([1 2]); figure; plot([1 2]); plot([3 4])", s);
    const list = f.list();
    expect(list[0].series).toHaveLength(1);
    expect(list[1].series).toHaveLength(1);
    go("figure(1); plot([9 9])", s);
    expect(f.list()[0].series).toHaveLength(2);
  });

  it("rejects bad figure numbers and more than the cap", () => {
    const { s } = setup();
    expect(() => go("figure(0)", s)).toThrow(CalcError);
    expect(() => go("figure(1.5)", s)).toThrow(CalcError);
    for (let i = 1; i <= MAX_FIGURES; i++) go(`figure(${i})`, s);
    go("figure(2)", s);
    expect(() => go(`figure(${MAX_FIGURES + 1})`, s)).toThrow("at most 8 figures");
  });

  it("caps points per series", () => {
    const { s } = setup();
    go(`plot(linspace(0, 1, ${MAX_POINTS}))`, s);
    expect(() => go(`plot(linspace(0, 1, ${MAX_POINTS + 1}))`, s)).toThrow("too many points");
  });
});

describe("plot pairing", () => {
  it("pairs x and y", () => {
    const { f, s } = setup();
    go("plot([1 2 3], [4 5 6])", s);
    const [a] = f.list()[0].series;
    expect(arr(a.x)).toEqual([1, 2, 3]);
    expect(arr(a.y)).toEqual([4, 5, 6]);
    expect(a.z).toBeNull();
  });

  it("accepts row and column vectors mixed", () => {
    const { f, s } = setup();
    go("plot([1 2 3], [4; 5; 6])", s);
    expect(arr(f.list()[0].series[0].y)).toEqual([4, 5, 6]);
  });

  it("plots several x, y pairs", () => {
    const { f, s } = setup();
    go("plot([1 2], [3 4], [5 6 7], [8 9 10])", s);
    expect(f.list()[0].series).toHaveLength(2);
  });

  it("plots one series per matrix column", () => {
    const { f, s } = setup();
    go("plot([1 2 3], [1 4; 2 5; 3 6])", s);
    const { series } = f.list()[0];
    expect(series).toHaveLength(2);
    expect(arr(series[0].y)).toEqual([1, 2, 3]);
    expect(arr(series[1].y)).toEqual([4, 5, 6]);
    expect(arr(series[1].x)).toEqual([1, 2, 3]);
  });

  it("plots a single matrix by column against 1..rows", () => {
    const { f, s } = setup();
    go("plot([1 4; 2 5; 3 6])", s);
    const { series } = f.list()[0];
    expect(series).toHaveLength(2);
    expect(arr(series[1].x)).toEqual([1, 2, 3]);
  });

  it("pairs matrix x with matrix y by column", () => {
    const { f, s } = setup();
    go("plot([1 10; 2 20], [3 4; 5 6])", s);
    const { series } = f.list()[0];
    expect(arr(series[1].x)).toEqual([10, 20]);
    expect(arr(series[1].y)).toEqual([4, 6]);
  });

  it("plots a scalar", () => {
    const { f, s } = setup();
    go("plot(5)", s);
    expect(arr(f.list()[0].series[0].x)).toEqual([1]);
  });

  it("plots matrix rows when x matches the row length", () => {
    const { f, s } = setup();
    go("x = [1 2 3]; plot(x, [x; 2*x])", s);
    const { series } = f.list()[0];
    expect(series).toHaveLength(2);
    expect(arr(series[1].y)).toEqual([2, 4, 6]);
    expect(arr(series[1].x)).toEqual([1, 2, 3]);
  });

  it("errors on mismatched input", () => {
    const { s } = setup();
    expect(() => go("plot([1 2 3], [1 2])", s)).toThrow("plot: x, y differ in length");
    expect(() => go("plot([1 2 3], [1 2; 3 4])", s)).toThrow("differ in size");
    expect(() => go("plot([1 2], [3 4], [5 6])", s)).toThrow("x, y pairs");
    expect(() => go("plot()", s)).toThrow("plot needs data");
  });
});

describe("plot3", () => {
  it("makes a 3D figure", () => {
    const { f, s } = setup();
    go("plot3([1 2 3], [4 5 6], [7 8 9])", s);
    const fig = f.list()[0];
    expect(fig.dims).toBe(3);
    expect(arr(fig.series[0].z as Float64Array)).toEqual([7, 8, 9]);
  });

  it("plots matrix columns", () => {
    const { f, s } = setup();
    go("plot3([1 2; 3 4], [1 2; 3 4], [5 6; 7 8])", s);
    expect(f.list()[0].series).toHaveLength(2);
  });

  it("lifts held 2D series to z = 0", () => {
    const { f, s } = setup();
    go("plot([1 2]); hold on; plot3([1 2], [3 4], [5 6])", s);
    const fig = f.list()[0];
    expect(fig.dims).toBe(3);
    expect(arr(fig.series[0].z as Float64Array)).toEqual([0, 0]);
  });

  it("draws plot into a 3D figure at z = 0", () => {
    const { f, s } = setup();
    go("plot3([1 2], [3 4], [5 6]); hold on; plot([1 2], [3 4])", s);
    expect(arr(f.list()[0].series[1].z as Float64Array)).toEqual([0, 0]);
  });

  it("returns to 2D when replaced", () => {
    const { f, s } = setup();
    go("plot3([1 2], [3 4], [5 6]); plot([1 2])", s);
    expect(f.list()[0].dims).toBe(2);
  });

  it("errors on bad counts and lengths", () => {
    const { s } = setup();
    expect(() => go("plot3([1 2], [3 4])", s)).toThrow("x, y, z triples");
    expect(() => go("plot3([1 2], [3 4], [5 6 7])", s)).toThrow("x, y, z differ in length");
  });
});

describe("statements", () => {
  it("marks draw calls", () => {
    expect(compileLine("plot([1 2])")[0].draw).toBe(true);
    expect(compileLine("plot3(1, 2, 3);")[0].draw).toBe(true);
    expect(compileLine("figure")[0].draw).toBe(true);
    expect(compileLine("figure(2)")[0].draw).toBe(true);
    expect(compileLine("hold on")[0].draw).toBe(true);
    expect(compileLine("hold off;")[0].draw).toBe(true);
    expect(compileLine("1 + 2")[0].draw).toBe(false);
    expect(compileLine("x = plot([1 2])")[0].draw).toBe(false);
    expect(compileLine("1 + plot([1 2])")[0].draw).toBe(false);
    expect(compileLine("format long")[0].draw).toBe(false);
  });

  it("splits command syntax from following statements", () => {
    const sts = compileLine("hold on; plot([1 2]), figure; hold off");
    expect(sts.map((x) => x.draw)).toEqual([true, true, true, true]);
  });

  it("still treats hold and figure as plain names elsewhere", () => {
    const s = env();
    go("hold = 3; figure = 4", s);
    expect(s.get("hold")).toBe(3);
    expect(s.get("figure")).toBe(4);
  });

  it("needs a calc block without a hook", () => {
    const s = env();
    expect(() => go("plot([1 2])", s)).toThrow("plot needs a calc block");
    expect(() => go("figure", s)).toThrow("figure needs a calc block");
    expect(() => go("hold on", s)).toThrow("hold needs a calc block");
  });
});

describe("plot parity", () => {
  it("parses LineSpec strings", () => {
    expect(parseLineSpec("r--o")).toEqual({ color: "#d95319", dash: "dash", marker: "circle" });
    expect(parseLineSpec("k:")).toEqual({ color: "#222222", dash: "dot" });
    expect(parseLineSpec("not-a-linespec")).toBeNull();
  });

  it("supports surf, mesh, contour, scatter, bar, histogram, subplot and axes labels", () => {
    const { f, s } = setup();
    go("[X, Y] = meshgrid(1:3, 1:2); Z = X + Y", s);
    go("subplot(1, 2, 1); surf(X, Y, Z); title('Surface'); xlabel('x'); ylabel('y'); zlabel('z'); colormap('viridis'); colorbar", s);
    go("subplot(1, 2, 2); contourf(X, Y, Z); grid on; xlim([1 3]); ylim([1 2])", s);

    const [fig] = f.list();
    expect(fig.rows).toBe(1);
    expect(fig.cols).toBe(2);
    const subs = fig.subplots!;
    expect(subs).toHaveLength(2);
    expect(subs[0].dims).toBe(3);
    expect(subs[0].traces[0].kind).toBe("surf");
    expect(subs[0].title).toBe("Surface");
    expect(subs[0].colormap).toBe("viridis");
    expect(subs[0].colorbar).toBe(true);
    expect(subs[1].traces[0].kind).toBe("contourf");
    expect(subs[1].grid).toBe(true);
    expect(subs[1].xlim).toEqual([1, 3]);
  });

  it("supports scatter, bar, histogram, legend and line specs", () => {
    const { f, s } = setup();
    go("plot([1 2 3], [2 4 6], 'r--o'); hold on; scatter([1 2 3], [6 4 2]); legend('line', 'pts')", s);
    const sub = f.list()[0].subplots![0];
    expect(sub.traces.map((t) => t.kind)).toEqual(["line2d", "scatter2d"]);
    expect(sub.traces[0].style?.dash).toBe("dash");
    expect(sub.traces[0].style?.marker).toBe("circle");
    expect(sub.legend).toEqual(["line", "pts"]);

    go("figure; bar([10 20 30]); figure; histogram([1 1 2 3 3 3], 3)", s);
    expect(f.list()[1].subplots![0].traces[0].kind).toBe("bar");
    expect(f.list()[2].subplots![0].traces[0].kind).toBe("histogram");
  });
});
