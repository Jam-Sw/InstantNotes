import { MATLAB_COLORS, type Figure, type SubplotSpec, type TraceSpec } from "$lib/calc/plot";
import type { Config, Data, Layout } from "plotly.js-dist-min";

export interface PlotTheme {
  ink: string;
  faint: string;
  grid: string;
  paper: string;
  fontFamily: string;
}

export const DEFAULT_PLOT_THEME: PlotTheme = {
  ink: "#22252a",
  faint: "#6e7582",
  grid: "rgba(128, 136, 150, 0.22)",
  paper: "rgba(0, 0, 0, 0)",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
};

export function readPlotTheme(el?: Element | null): PlotTheme {
  if (typeof window === "undefined" || typeof getComputedStyle === "undefined") {
    return DEFAULT_PLOT_THEME;
  }
  const target = el ?? document.documentElement;
  const cs = getComputedStyle(target);
  const pick = (...vars: string[]) => {
    for (const v of vars) {
      const val = cs.getPropertyValue(v).trim();
      if (val) return val;
    }
    return "";
  };
  const ink = pick("--text", "--ink") || DEFAULT_PLOT_THEME.ink;
  const faint = pick("--text-secondary", "--ink-faint") || ink;
  const line = pick("--border", "--line") || DEFAULT_PLOT_THEME.grid;
  const font = pick("--font-meta", "--font-sans") || DEFAULT_PLOT_THEME.fontFamily;
  return {
    ink,
    faint,
    grid: line,
    paper: "rgba(0, 0, 0, 0)",
    fontFamily: font,
  };
}

export type ColorScale = [number, string][];

const COLORMAPS: Record<string, ColorScale> = {
  parula: [
    [0.0, "#352a87"],
    [0.16, "#0363e1"],
    [0.33, "#1485d4"],
    [0.5, "#06a7c6"],
    [0.67, "#38b99e"],
    [0.84, "#92bf73"],
    [1.0, "#f9fb0e"],
  ],
  viridis: [
    [0.0, "#440154"],
    [0.25, "#3b528b"],
    [0.5, "#21918c"],
    [0.75, "#5ec962"],
    [1.0, "#fde725"],
  ],
  turbo: [
    [0.0, "#30123b"],
    [0.2, "#4662d7"],
    [0.4, "#1ae4b6"],
    [0.6, "#a2fc3c"],
    [0.8, "#faba39"],
    [1.0, "#7a0403"],
  ],
  jet: [
    [0.0, "#00008f"],
    [0.125, "#0000ff"],
    [0.375, "#00ffff"],
    [0.625, "#ffff00"],
    [0.875, "#ff0000"],
    [1.0, "#800000"],
  ],
  hot: [
    [0.0, "#0b0000"],
    [0.38, "#ff0000"],
    [0.75, "#ffff00"],
    [1.0, "#ffffff"],
  ],
  cool: [
    [0.0, "#00ffff"],
    [1.0, "#ff00ff"],
  ],
  gray: [
    [0.0, "#000000"],
    [1.0, "#ffffff"],
  ],
  bone: [
    [0.0, "#000000"],
    [0.375, "#34344c"],
    [0.75, "#7c9b9b"],
    [1.0, "#ffffff"],
  ],
  copper: [
    [0.0, "#000000"],
    [0.8, "#ffa066"],
    [1.0, "#ffc77f"],
  ],
  plasma: [
    [0.0, "#0d0887"],
    [0.5, "#cc4778"],
    [1.0, "#f0f921"],
  ],
};

export function resolveColorscale(name?: string): ColorScale {
  if (!name) return COLORMAPS.parula;
  return COLORMAPS[name.toLowerCase()] ?? COLORMAPS.parula;
}

export interface CameraEye {
  x: number;
  y: number;
  z: number;
}

export function cameraEyeFromView(azDeg = -37.5, elDeg = 30, radius = 2.05): CameraEye {
  const az = ((azDeg - 90) * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    x: radius * cosEl * Math.cos(az),
    y: radius * cosEl * Math.sin(az),
    z: radius * Math.sin(el),
  };
}

export interface SubplotBinding {
  index: number;
  dims: 2 | 3;
  kind: "cartesian" | "scene" | "polar" | "pie";
  domainX: [number, number];
  domainY: [number, number];
  xAxisKey?: string;
  yAxisKey?: string;
  sceneKey?: string;
  xscale?: "linear" | "log";
  yscale?: "linear" | "log";
  initialXRange?: [number, number];
  initialYRange?: [number, number];
  initialEye?: CameraEye;
  azDeg: number;
  elDeg: number;
  radius: number;
}

export interface PlotlySpecResult {
  data: Data[];
  layout: Partial<Layout>;
  config: Partial<Config>;
  subplots: SubplotBinding[];
}

function normalizedSubplots(fig: Figure): { rows: number; cols: number; list: SubplotSpec[] } {
  const rows = fig.rows ?? 1;
  const cols = fig.cols ?? 1;
  if (fig.subplots && fig.subplots.length > 0) {
    return { rows, cols, list: fig.subplots };
  }
  const traces: TraceSpec[] = fig.series.map((s) =>
    s.z !== null ? { kind: "line3d", x: s.x, y: s.y, z: s.z } : { kind: "line2d", x: s.x, y: s.y },
  );
  return {
    rows: 1,
    cols: 1,
    list: [{ row: 1, col: 1, index: 1, dims: fig.dims, traces }],
  };
}

function matrixRows(m: { rows: number; cols: number; data: Float64Array }): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < m.rows; r++) {
    out.push(Array.from(m.data.subarray(r * m.cols, (r + 1) * m.cols)));
  }
  return out;
}

function markerSizeFor(sz: Float64Array | number | undefined, fallback = 7): number | number[] {
  if (sz === undefined) return fallback;
  if (typeof sz === "number") {
    return sz > 16 ? Math.max(4, Math.min(36, Math.sqrt(sz) * 1.3)) : Math.max(3, sz);
  }
  return Array.from(sz, (v) => (v > 16 ? Math.max(3, Math.min(36, Math.sqrt(v) * 1.3)) : Math.max(3, v)));
}

function finiteBounds(arrays: (Float64Array | undefined)[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

function quiverPoints(x: Float64Array, y: Float64Array, u: Float64Array, v: Float64Array): { px: number[]; py: number[] } {
  let maxMag = 0;
  for (let i = 0; i < u.length; i++) {
    const m = Math.hypot(u[i], v[i]);
    if (Number.isFinite(m) && m > maxMag) maxMag = m;
  }
  const xb = finiteBounds([x]);
  const yb = finiteBounds([y]);
  const span = Math.max(xb ? xb[1] - xb[0] : 1, yb ? yb[1] - yb[0] : 1);
  const scale = maxMag > 0 ? (span / Math.max(4, Math.sqrt(x.length) * 1.35)) / maxMag : 1;
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = y[i];
    const dx = u[i] * scale;
    const dy = v[i] * scale;
    const x1 = x0 + dx;
    const y1 = y0 + dy;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len === 0) continue;
    const head = len * 0.24;
    const ang = Math.atan2(dy, dx);
    const a1 = ang + Math.PI * 0.82;
    const a2 = ang - Math.PI * 0.82;
    px.push(x0, x1, NaN, x1, x1 + head * Math.cos(a1), NaN, x1, x1 + head * Math.cos(a2), NaN);
    py.push(y0, y1, NaN, y1, y1 + head * Math.sin(a1), NaN, y1, y1 + head * Math.sin(a2), NaN);
  }
  return { px, py };
}

function subplotDomain(
  row: number,
  col: number,
  rows: number,
  cols: number,
  hasTitle: boolean,
): { domainX: [number, number]; domainY: [number, number] } {
  const gapX = cols > 1 ? Math.min(0.1, 0.08) : 0;
  const gapY = rows > 1 ? Math.min(0.14, 0.11 + (hasTitle ? 0.03 : 0)) : 0;
  const cellW = (1 - gapX * (cols - 1)) / cols;
  const cellH = (1 - gapY * (rows - 1)) / rows;
  const x0 = (col - 1) * (cellW + gapX);
  const x1 = x0 + cellW;
  const invRow = rows - row;
  const y0 = invRow * (cellH + gapY);
  const y1 = y0 + cellH;
  return {
    domainX: [Number(x0.toFixed(4)), Number(x1.toFixed(4))],
    domainY: [Number(y0.toFixed(4)), Number(y1.toFixed(4))],
  };
}

export function buildPlotlySpec(
  fig: Figure,
  size: { width: number; height: number },
  theme: PlotTheme = DEFAULT_PLOT_THEME,
): PlotlySpecResult {
  const { rows, cols, list } = normalizedSubplots(fig);
  const anyTitle = list.some((s) => Boolean(s.title));
  const data: Data[] = [];
  const bindings: SubplotBinding[] = [];
  const annotations: NonNullable<Layout["annotations"]> = [];

  const layout: Record<string, unknown> = {
    width: size.width,
    height: size.height,
    paper_bgcolor: theme.paper,
    plot_bgcolor: theme.paper,
    font: {
      family: theme.fontFamily,
      size: 11,
      color: theme.faint,
    },
    margin: {
      l: 48,
      r: list.some((s) => s.colorbar) ? 56 : 20,
      t: anyTitle ? 34 : 18,
      b: list.some((s) => Boolean(s.xlabel)) ? 42 : 30,
    },
    hovermode: "closest",
    dragmode: fig.dims === 3 ? "orbit" : "pan",
    showlegend: false,
  };

  let cartIdx = 0;
  let sceneIdx = 0;
  let polarIdx = 0;

  for (const sub of list) {
    const { domainX, domainY } = subplotDomain(sub.row, sub.col, rows, cols, anyTitle);
    const colorscale = resolveColorscale(sub.colormap);
    const legendLabels = Array.isArray(sub.legend) ? sub.legend : null;
    const wantLegend =
      sub.legend === true ||
      (legendLabels !== null && legendLabels.length > 0) ||
      (sub.legend !== false && sub.traces.some((t) => Boolean(t.style?.name)));
    if (wantLegend) layout.showlegend = true;

    if (sub.title) {
      annotations.push({
        text: sub.title,
        x: (domainX[0] + domainX[1]) / 2,
        y: domainY[1],
        xref: "paper",
        yref: "paper",
        xanchor: "center",
        yanchor: "bottom",
        yshift: 4,
        showarrow: false,
        font: { size: 12.5, color: theme.ink, family: theme.fontFamily },
      });
    }

    const isPolar = sub.traces.length > 0 && sub.traces.every((t) => t.kind === "polar");
    const isPie = sub.traces.length > 0 && sub.traces.every((t) => t.kind === "pie");

    if (isPie) {
      for (const t of sub.traces) {
        data.push({
          type: "pie",
          values: t.x ? Array.from(t.x) : [],
          labels: t.labels,
          domain: { x: domainX, y: domainY },
          marker: { colors: MATLAB_COLORS },
          textinfo: "label+percent",
        } as Data);
      }
      bindings.push({
        index: sub.index,
        dims: 2,
        kind: "pie",
        domainX,
        domainY,
        azDeg: 0,
        elDeg: 90,
        radius: 2.05,
      });
      continue;
    }

    if (isPolar) {
      polarIdx++;
      const polarKey = polarIdx === 1 ? "polar" : `polar${polarIdx}`;
      layout[polarKey] = {
        domain: { x: domainX, y: domainY },
        bgcolor: theme.paper,
        radialaxis: { gridcolor: theme.grid, linecolor: theme.grid, tickfont: { size: 10, color: theme.faint } },
        angularaxis: { gridcolor: theme.grid, linecolor: theme.grid, tickfont: { size: 10, color: theme.faint } },
      };
      sub.traces.forEach((t, ti) => {
        const color = t.style?.color ?? MATLAB_COLORS[ti % MATLAB_COLORS.length];
        const name = legendLabels?.[ti] ?? t.style?.name;
        data.push({
          type: "scatterpolar",
          subplot: polarKey,
          theta: t.x ? Array.from(t.x, (rad) => (rad * 180) / Math.PI) : [],
          r: t.y ? Array.from(t.y) : [],
          mode: t.style?.marker && t.style?.dash === "none" ? "markers" : t.style?.marker ? "lines+markers" : "lines",
          line: { color, width: t.style?.lineWidth ?? 1.75, dash: t.style?.dash === "none" ? "solid" : t.style?.dash },
          ...(t.style?.marker ? { marker: { symbol: t.style.marker, size: t.style.markerSize ?? 6, color } } : {}),
          name,
          showlegend: wantLegend && Boolean(name),
        } as Data);
      });
      bindings.push({
        index: sub.index,
        dims: 2,
        kind: "polar",
        domainX,
        domainY,
        azDeg: 0,
        elDeg: 90,
        radius: 2.05,
      });
      continue;
    }

    if (sub.dims === 3) {
      sceneIdx++;
      const sceneKey = sceneIdx === 1 ? "scene" : `scene${sceneIdx}`;
      const [azDeg, elDeg] = sub.view ?? [-37.5, 30];
      const radius = 2.05;
      const eye = cameraEyeFromView(azDeg, elDeg, radius);
      const showGrid = sub.grid !== false;
      const visible = sub.axisVisible !== false;
      layout[sceneKey] = {
        domain: { x: domainX, y: domainY },
        dragmode: "orbit",
        aspectmode: sub.aspectEqual ? "data" : "cube",
        camera: {
          eye,
          up: { x: 0, y: 0, z: 1 },
          center: { x: 0, y: 0, z: 0 },
        },
        xaxis: {
          title: { text: sub.xlabel ?? "x", font: { size: 11, color: theme.ink } },
          range: sub.xlim ?? undefined,
          showgrid: showGrid,
          gridcolor: theme.grid,
          zerolinecolor: theme.grid,
          visible,
          showbackground: false,
        },
        yaxis: {
          title: { text: sub.ylabel ?? "y", font: { size: 11, color: theme.ink } },
          range: sub.ylim ?? undefined,
          showgrid: showGrid,
          gridcolor: theme.grid,
          zerolinecolor: theme.grid,
          visible,
          showbackground: false,
        },
        zaxis: {
          title: { text: sub.zlabel ?? "z", font: { size: 11, color: theme.ink } },
          range: sub.zlim ?? undefined,
          showgrid: showGrid,
          gridcolor: theme.grid,
          zerolinecolor: theme.grid,
          visible,
          showbackground: false,
        },
      };

      sub.traces.forEach((t, ti) => {
        const color = t.style?.color ?? MATLAB_COLORS[ti % MATLAB_COLORS.length];
        const name = legendLabels?.[ti] ?? t.style?.name;
        const showTraceLegend = wantLegend && (Boolean(name) || sub.legend === true);
        if (t.kind === "surf" || t.kind === "surfc" || t.kind === "mesh") {
          if (!t.matrix) return;
          const zRows = matrixRows(t.matrix);
          const baseSurf: Record<string, unknown> = {
            type: "surface",
            scene: sceneKey,
            z: zRows,
            x: t.x ? Array.from(t.x) : undefined,
            y: t.y ? Array.from(t.y) : undefined,
            colorscale,
            showscale: Boolean(sub.colorbar) && ti === 0,
            name,
            showlegend: showTraceLegend,
          };
          if (t.kind === "surfc") {
            baseSurf.contours = {
              z: { show: true, usecolormap: true, project: { z: true } },
            };
          } else if (t.kind === "mesh") {
            baseSurf.opacity = 0.9;
            baseSurf.contours = {
              x: { show: true, color: theme.ink, width: 1 },
              y: { show: true, color: theme.ink, width: 1 },
            };
          }
          data.push(baseSurf as Data);
          return;
        }
        if (t.kind === "scatter3d") {
          data.push({
            type: "scatter3d",
            scene: sceneKey,
            mode: "markers",
            x: t.x ? Array.from(t.x) : [],
            y: t.y ? Array.from(t.y) : [],
            z: t.z ? Array.from(t.z) : [],
            marker: {
              size: markerSizeFor(t.size, t.style?.markerSize ?? 4),
              symbol: t.style?.marker ?? "circle",
              color: t.cdata ? Array.from(t.cdata) : color,
              colorscale: t.cdata ? colorscale : undefined,
              showscale: Boolean(t.cdata && sub.colorbar),
            },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        }
        const hasMarker = Boolean(t.style?.marker);
        const noLine = t.style?.dash === "none";
        const mode = noLine ? "markers" : hasMarker ? "lines+markers" : "lines";
        data.push({
          type: "scatter3d",
          scene: sceneKey,
          mode,
          x: t.x ? Array.from(t.x) : [],
          y: t.y ? Array.from(t.y) : [],
          z: t.z ? Array.from(t.z) : [],
          line: noLine
            ? undefined
            : {
                color,
                width: t.style?.lineWidth ?? 2.2,
                dash: t.style?.dash === "dashdot" ? "longdashdot" : t.style?.dash ?? "solid",
              },
          ...(hasMarker ? { marker: { symbol: t.style?.marker, size: t.style?.markerSize ?? 4, color } } : {}),
          name,
          showlegend: showTraceLegend,
        } as Data);
      });

      bindings.push({
        index: sub.index,
        dims: 3,
        kind: "scene",
        domainX,
        domainY,
        sceneKey,
        initialEye: eye,
        azDeg,
        elDeg,
        radius,
      });
      continue;
    }

    cartIdx++;
    const xAxisKey = cartIdx === 1 ? "xaxis" : `xaxis${cartIdx}`;
    const yAxisKey = cartIdx === 1 ? "yaxis" : `yaxis${cartIdx}`;
    const xRef = cartIdx === 1 ? "x" : `x${cartIdx}`;
    const yRef = cartIdx === 1 ? "y" : `y${cartIdx}`;
    const showGrid = sub.grid === true;
    const showBox = sub.box !== false;
    const visible = sub.axisVisible !== false;

    const autoX = sub.xlim ?? finiteBounds(sub.traces.map((t) => (t.kind === "barh" ? t.y : t.x)));
    const autoY = sub.ylim ?? finiteBounds(sub.traces.map((t) => (t.kind === "barh" ? t.x : t.y)));

    layout[xAxisKey] = {
      domain: domainX,
      anchor: yRef,
      type: sub.xscale ?? "linear",
      range: sub.xlim ? [...sub.xlim] : undefined,
      autorange: !sub.xlim,
      title: sub.xlabel ? { text: sub.xlabel, font: { size: 11.5, color: theme.ink } } : undefined,
      showgrid: showGrid,
      gridcolor: theme.grid,
      zeroline: showGrid,
      zerolinecolor: theme.grid,
      showline: true,
      mirror: showBox,
      linecolor: theme.grid,
      ticks: "outside",
      ticklen: 4,
      tickcolor: theme.grid,
      visible,
    };

    layout[yAxisKey] = {
      domain: domainY,
      anchor: xRef,
      type: sub.yscale ?? "linear",
      range: sub.ylim ? [...sub.ylim] : undefined,
      autorange: !sub.ylim,
      title: sub.ylabel ? { text: sub.ylabel, font: { size: 11.5, color: theme.ink } } : undefined,
      showgrid: showGrid,
      gridcolor: theme.grid,
      zeroline: showGrid,
      zerolinecolor: theme.grid,
      showline: true,
      mirror: showBox,
      linecolor: theme.grid,
      ticks: "outside",
      ticklen: 4,
      tickcolor: theme.grid,
      visible,
      scaleanchor: sub.aspectEqual ? xRef : undefined,
      scaleratio: sub.aspectEqual ? 1 : undefined,
    };

    sub.traces.forEach((t, ti) => {
      const color = t.style?.color ?? MATLAB_COLORS[ti % MATLAB_COLORS.length];
      const name = legendLabels?.[ti] ?? t.style?.name;
      const showTraceLegend = wantLegend && (Boolean(name) || sub.legend === true);

      switch (t.kind) {
        case "bar":
          data.push({
            type: "bar",
            xaxis: xRef,
            yaxis: yRef,
            x: t.x ? Array.from(t.x) : [],
            y: t.y ? Array.from(t.y) : [],
            marker: { color },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "barh":
          data.push({
            type: "bar",
            orientation: "h",
            xaxis: xRef,
            yaxis: yRef,
            x: t.y ? Array.from(t.y) : [],
            y: t.x ? Array.from(t.x) : [],
            marker: { color },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "histogram":
          data.push({
            type: "histogram",
            xaxis: xRef,
            yaxis: yRef,
            x: t.x ? Array.from(t.x) : [],
            nbinsx: t.nbins,
            marker: { color, line: { color: theme.paper, width: 0.6 } },
            opacity: 0.85,
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "contour":
        case "contourf":
          if (!t.matrix) return;
          data.push({
            type: "contour",
            xaxis: xRef,
            yaxis: yRef,
            z: matrixRows(t.matrix),
            x: t.x ? Array.from(t.x) : undefined,
            y: t.y ? Array.from(t.y) : undefined,
            ncontours: t.nlevels,
            colorscale,
            showscale: Boolean(sub.colorbar),
            contours: {
              coloring: t.kind === "contourf" ? "fill" : "lines",
            },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "heatmap":
          if (!t.matrix) return;
          data.push({
            type: "heatmap",
            xaxis: xRef,
            yaxis: yRef,
            z: matrixRows(t.matrix),
            x: t.x ? Array.from(t.x) : undefined,
            y: t.y ? Array.from(t.y) : undefined,
            colorscale,
            showscale: Boolean(sub.colorbar),
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "scatter2d":
          data.push({
            type: "scatter",
            mode: "markers",
            xaxis: xRef,
            yaxis: yRef,
            x: t.x ? Array.from(t.x) : [],
            y: t.y ? Array.from(t.y) : [],
            marker: {
              symbol: t.style?.marker ?? "circle",
              size: markerSizeFor(t.size, t.style?.markerSize ?? 7),
              color: t.cdata ? Array.from(t.cdata) : color,
              colorscale: t.cdata ? colorscale : undefined,
              showscale: Boolean(t.cdata && sub.colorbar),
            },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        case "stem": {
          const xs = t.x ?? new Float64Array(0);
          const ys = t.y ?? new Float64Array(0);
          const sx: number[] = [];
          const sy: number[] = [];
          for (let i = 0; i < xs.length; i++) {
            sx.push(xs[i], xs[i], NaN);
            sy.push(0, ys[i], NaN);
          }
          data.push({
            type: "scatter",
            mode: "lines",
            xaxis: xRef,
            yaxis: yRef,
            x: sx,
            y: sy,
            line: { color, width: t.style?.lineWidth ?? 1.5, dash: t.style?.dash === "none" ? "solid" : t.style?.dash },
            hoverinfo: "skip",
            showlegend: false,
          } as Data);
          data.push({
            type: "scatter",
            mode: "markers",
            xaxis: xRef,
            yaxis: yRef,
            x: Array.from(xs),
            y: Array.from(ys),
            marker: { symbol: t.style?.marker ?? "circle", size: t.style?.markerSize ?? 6.5, color },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        }
        case "quiver": {
          if (!t.x || !t.y || !t.u || !t.v) return;
          const { px, py } = quiverPoints(t.x, t.y, t.u, t.v);
          data.push({
            type: "scatter",
            mode: "lines",
            xaxis: xRef,
            yaxis: yRef,
            x: px,
            y: py,
            line: { color, width: t.style?.lineWidth ?? 1.5 },
            name,
            showlegend: showTraceLegend,
          } as Data);
          return;
        }
        case "errorbar":
        case "stairs":
        case "area":
        case "line2d":
        default: {
          const hasMarker = Boolean(t.style?.marker);
          const noLine = t.style?.dash === "none";
          const mode = noLine ? "markers" : hasMarker ? "lines+markers" : "lines";
          data.push({
            type: "scatter",
            mode,
            xaxis: xRef,
            yaxis: yRef,
            x: t.x ? Array.from(t.x) : [],
            y: t.y ? Array.from(t.y) : [],
            fill: t.kind === "area" ? "tozeroy" : undefined,
            line: noLine
              ? undefined
              : {
                  color,
                  width: t.style?.lineWidth ?? 1.75,
                  dash: t.style?.dash,
                  shape: t.kind === "stairs" ? "hv" : "linear",
                },
            ...(hasMarker ? { marker: { symbol: t.style?.marker, size: t.style?.markerSize ?? 6, color } } : {}),
            error_y:
              t.kind === "errorbar" && t.err
                ? { type: "data", array: Array.from(t.err), visible: true, color }
                : undefined,
            name,
            showlegend: showTraceLegend,
          } as Data);
        }
      }
    });

    bindings.push({
      index: sub.index,
      dims: 2,
      kind: "cartesian",
      domainX,
      domainY,
      xAxisKey,
      yAxisKey,
      xscale: sub.xscale ?? "linear",
      yscale: sub.yscale ?? "linear",
      initialXRange: sub.xlim ? [...sub.xlim] : autoX,
      initialYRange: sub.ylim ? [...sub.ylim] : autoY,
      azDeg: 0,
      elDeg: 90,
      radius: 2.05,
    });
  }

  if (annotations.length > 0) layout.annotations = annotations;
  if (layout.showlegend) {
    layout.legend = {
      bgcolor: "rgba(0,0,0,0)",
      font: { size: 11, color: theme.ink },
    };
  }

  const config: Partial<Config> = {
    scrollZoom: false,
    displaylogo: false,
    responsive: false,
    doubleClick: "reset",
    displayModeBar: false,
  };

  return { data, layout: layout as Partial<Layout>, config, subplots: bindings };
}
