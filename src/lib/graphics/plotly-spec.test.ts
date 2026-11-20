import { describe, expect, it } from "vitest";
import { compileLine, type Scope, type Value } from "$lib/calc/engine";
import { Figures } from "$lib/calc/plot";
import { buildPlotlySpec, cameraEyeFromView } from "./plotly-spec";

function makeFigures(code: string) {
  const draw = new Figures();
  const vars = new Map<string, Value>();
  const scope: Scope = { draw, get: (n) => vars.get(n), set: (n, v) => void vars.set(n, v) };
  for (const st of compileLine(code)) st.run(scope);
  return draw.list();
}

describe("buildPlotlySpec", () => {
  it("converts 2D plots with LineSpec, labels, legend, grid, and limits", () => {
    const [fig] = makeFigures(
      "x = linspace(0, 10, 50); plot(x, sin(x), 'r--o'); title('Wave'); xlabel('t'); ylabel('amp'); legend('sin'); grid on; xlim([0 10])",
    );
    const spec = buildPlotlySpec(fig, { width: 480, height: 300 });
    expect(spec.config.scrollZoom).toBe(false);
    expect(spec.config.displayModeBar).toBe(false);
    expect(spec.config.displaylogo).toBe(false);
    expect(spec.data).toHaveLength(1);
    const trace = spec.data[0] as Record<string, unknown>;
    expect(trace.type).toBe("scatter");
    expect(trace.mode).toBe("lines+markers");
    expect(trace.name).toBe("sin");
    expect(spec.layout.showlegend).toBe(true);
    const xaxis = (spec.layout as Record<string, unknown>).xaxis as Record<string, unknown>;
    expect(xaxis.range).toEqual([0, 10]);
    expect(xaxis.showgrid).toBe(true);
    expect(spec.layout.annotations?.[0]?.text).toBe("Wave");
  });

  it("maps 3D surf, mesh, contourf, and subplot grids with independent domains", () => {
    const [fig] = makeFigures(
      "[X, Y] = meshgrid(-2:1:2, -2:1:2); Z = X.^2 + Y.^2; subplot(1, 2, 1); surf(X, Y, Z); colormap('viridis'); colorbar; subplot(1, 2, 2); contourf(X, Y, Z)",
    );
    const spec = buildPlotlySpec(fig, { width: 640, height: 360 });
    expect(spec.subplots).toHaveLength(2);
    expect(spec.subplots[0].kind).toBe("scene");
    expect(spec.subplots[1].kind).toBe("cartesian");
    expect(spec.subplots[0].domainX[1]).toBeLessThan(spec.subplots[1].domainX[0]);
    expect((spec.data[0] as Record<string, unknown>).type).toBe("surface");
    expect((spec.data[1] as Record<string, unknown>).type).toBe("contour");
  });

  it("supports stem, quiver, polarplot, barh, and pie", () => {
    const figs = makeFigures(
      "stem([1 2 3], [4 5 6]); figure; quiver([0 1], [0 1], [1 0], [0 1]); figure; polarplot([0 pi/2], [1 2]); figure; barh([1 2], [10 20]); figure; pie([30 70], 'A, B')",
    );
    const specs = figs.map((f) => buildPlotlySpec(f, { width: 400, height: 260 }));
    expect(specs[0].data).toHaveLength(2);
    expect((specs[1].data[0] as Record<string, unknown>).mode).toBe("lines");
    expect((specs[2].data[0] as Record<string, unknown>).type).toBe("scatterpolar");
    expect((specs[3].data[0] as Record<string, unknown>).orientation).toBe("h");
    expect((specs[4].data[0] as Record<string, unknown>).type).toBe("pie");
  });

  it("computes finite 3D camera eye coordinates from azimuth and elevation", () => {
    const eye = cameraEyeFromView(-37.5, 30, 2);
    expect(Math.hypot(eye.x, eye.y, eye.z)).toBeCloseTo(2, 5);
    expect(eye.z).toBeCloseTo(1, 5);
  });
});
