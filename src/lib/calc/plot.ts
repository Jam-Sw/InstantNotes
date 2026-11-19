import { CalcError } from "./engine";

export interface Series {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array | null;
}

type LineDash = "solid" | "dash" | "dot" | "dashdot" | "none";

export interface LineStyleSpec {
  color?: string;
  dash?: LineDash;
  marker?: string;
  lineWidth?: number;
  markerSize?: number;
  name?: string;
}

type TraceKind =
  | "line2d"
  | "scatter2d"
  | "bar"
  | "barh"
  | "histogram"
  | "stairs"
  | "stem"
  | "area"
  | "errorbar"
  | "quiver"
  | "polar"
  | "pie"
  | "contour"
  | "contourf"
  | "heatmap"
  | "line3d"
  | "scatter3d"
  | "surf"
  | "surfc"
  | "mesh";

export interface TraceSpec {
  kind: TraceKind;
  x?: Float64Array;
  y?: Float64Array;
  z?: Float64Array;
  u?: Float64Array;
  v?: Float64Array;
  err?: Float64Array;
  size?: Float64Array | number;
  cdata?: Float64Array;
  matrix?: { rows: number; cols: number; data: Float64Array };
  nbins?: number;
  nlevels?: number;
  labels?: string[];
  style?: LineStyleSpec;
}

export interface SubplotSpec {
  row: number;
  col: number;
  index: number;
  dims: 2 | 3;
  traces: TraceSpec[];
  title?: string;
  xlabel?: string;
  ylabel?: string;
  zlabel?: string;
  xlim?: [number, number] | null;
  ylim?: [number, number] | null;
  zlim?: [number, number] | null;
  xscale?: "linear" | "log";
  yscale?: "linear" | "log";
  grid?: boolean | null;
  box?: boolean;
  axisVisible?: boolean;
  aspectEqual?: boolean;
  axisTight?: boolean;
  legend?: string[] | boolean | null;
  colormap?: string;
  colorbar?: boolean;
  view?: [number, number] | null;
}

export interface Figure {
  id: number;
  dims: 2 | 3;
  series: Series[];
  rows?: number;
  cols?: number;
  subplots?: SubplotSpec[];
}

export const PLOT_COLORS = [
  "#0072bd",
  "#d95319",
  "#edb120",
  "#7e2f8e",
  "#77ac30",
  "#4dbeee",
  "#a2142f",
];

const SPEC_COLORS: Record<string, string> = {
  b: "#0072bd",
  r: "#d95319",
  y: "#edb120",
  m: "#7e2f8e",
  g: "#77ac30",
  c: "#4dbeee",
  k: "#222222",
  w: "#ffffff",
};

const SPEC_MARKERS: Record<string, string> = {
  o: "circle",
  "+": "cross-thin",
  "*": "asterisk",
  ".": "circle-dot",
  x: "x-thin",
  s: "square",
  d: "diamond",
  "^": "triangle-up",
  v: "triangle-down",
  ">": "triangle-right",
  "<": "triangle-left",
  p: "star",
  h: "hexagram",
};

export function parseLineSpec(raw: string): LineStyleSpec | null {
  let s = raw.trim();
  if (!s) return {};
  let dash: LineDash | undefined;
  for (const [tok, d] of [
    ["-.", "dashdot"],
    ["--", "dash"],
    [":", "dot"],
    ["-", "solid"],
  ] as const) {
    if (s.includes(tok)) {
      dash = d;
      s = s.replace(tok, "");
      break;
    }
  }
  const lower = s.toLowerCase();
  let marker: string | undefined;
  for (const [word, m] of [
    ["pentagram", "star"],
    ["hexagram", "hexagram"],
    ["diamond", "diamond"],
    ["square", "square"],
  ] as const) {
    if (lower.includes(word)) {
      marker = m;
      s = s.slice(0, lower.indexOf(word)) + s.slice(lower.indexOf(word) + word.length);
      break;
    }
  }
  let color: string | undefined;
  for (const ch of s) {
    const low = ch.toLowerCase();
    if (!color && SPEC_COLORS[low]) {
      color = SPEC_COLORS[low];
    } else if (!marker && SPEC_MARKERS[low]) {
      marker = SPEC_MARKERS[low];
    } else {
      return null;
    }
  }
  if (marker && !dash) dash = "none";
  return { color, dash, marker };
}

function sameArr(p?: Float64Array | null, q?: Float64Array | null): boolean {
  if (p === q) return true;
  if (!p || !q || p.length !== q.length) return false;
  for (let i = 0; i < p.length; i++) if (!Object.is(p[i], q[i])) return false;
  return true;
}

function sameStyle(a?: LineStyleSpec, b?: LineStyleSpec): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.color === b.color &&
    a.dash === b.dash &&
    a.marker === b.marker &&
    a.lineWidth === b.lineWidth &&
    a.markerSize === b.markerSize &&
    a.name === b.name
  );
}

function sameTrace(a: TraceSpec, b: TraceSpec): boolean {
  if (a === b) return true;
  if (
    a.kind !== b.kind ||
    a.nbins !== b.nbins ||
    a.nlevels !== b.nlevels ||
    !sameArr(a.x, b.x) ||
    !sameArr(a.y, b.y) ||
    !sameArr(a.z, b.z) ||
    !sameArr(a.u, b.u) ||
    !sameArr(a.v, b.v) ||
    !sameArr(a.err, b.err) ||
    !sameArr(a.cdata, b.cdata) ||
    !sameStyle(a.style, b.style)
  ) {
    return false;
  }
  if (typeof a.size === "number" || typeof b.size === "number") {
    if (a.size !== b.size) return false;
  } else if (!sameArr(a.size, b.size)) {
    return false;
  }
  if (a.matrix || b.matrix) {
    if (
      !a.matrix ||
      !b.matrix ||
      a.matrix.rows !== b.matrix.rows ||
      a.matrix.cols !== b.matrix.cols ||
      !sameArr(a.matrix.data, b.matrix.data)
    ) {
      return false;
    }
  }
  if ((a.labels?.join("\u0000") ?? "") !== (b.labels?.join("\u0000") ?? "")) return false;
  return true;
}

function samePair(a?: [number, number] | null, b?: [number, number] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
}

function sameLegend(a?: string[] | boolean | null, b?: string[] | boolean | null): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

function sameSubplot(a: SubplotSpec, b: SubplotSpec): boolean {
  if (a === b) return true;
  return (
    a.row === b.row &&
    a.col === b.col &&
    a.index === b.index &&
    a.dims === b.dims &&
    a.title === b.title &&
    a.xlabel === b.xlabel &&
    a.ylabel === b.ylabel &&
    a.zlabel === b.zlabel &&
    samePair(a.xlim, b.xlim) &&
    samePair(a.ylim, b.ylim) &&
    samePair(a.zlim, b.zlim) &&
    (a.xscale ?? "linear") === (b.xscale ?? "linear") &&
    (a.yscale ?? "linear") === (b.yscale ?? "linear") &&
    a.grid === b.grid &&
    (a.box ?? true) === (b.box ?? true) &&
    (a.axisVisible ?? true) === (b.axisVisible ?? true) &&
    Boolean(a.aspectEqual) === Boolean(b.aspectEqual) &&
    Boolean(a.axisTight) === Boolean(b.axisTight) &&
    sameLegend(a.legend, b.legend) &&
    a.colormap === b.colormap &&
    Boolean(a.colorbar) === Boolean(b.colorbar) &&
    samePair(a.view, b.view) &&
    a.traces.length === b.traces.length &&
    a.traces.every((t, i) => sameTrace(t, b.traces[i]))
  );
}

export function sameFigure(a: Figure, b: Figure): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.dims !== b.dims ||
    (a.rows ?? 1) !== (b.rows ?? 1) ||
    (a.cols ?? 1) !== (b.cols ?? 1) ||
    a.series.length !== b.series.length
  ) {
    return false;
  }
  const seriesOk = a.series.every((s, i) => {
    const t = b.series[i];
    return sameArr(s.x, t.x) && sameArr(s.y, t.y) && sameArr(s.z, t.z);
  });
  if (!seriesOk) return false;
  const sa = a.subplots ?? [];
  const sb = b.subplots ?? [];
  if (sa.length !== sb.length) return false;
  return sa.every((sp, i) => sameSubplot(sp, sb[i]));
}

export const MAX_FIGURES = 8;
export const MAX_POINTS = 20000;

interface AxesSlot {
  spec: SubplotSpec;
  hold: boolean;
}

interface FigureSlot {
  rows: number;
  cols: number;
  activeIndex: number;
  axes: Map<number, AxesSlot>;
}

const THREE_D_KINDS: ReadonlySet<TraceKind> = new Set([
  "line3d",
  "scatter3d",
  "surf",
  "surfc",
  "mesh",
]);

function traceDims(traces: readonly TraceSpec[]): 2 | 3 {
  return traces.some((t) => THREE_D_KINDS.has(t.kind)) ? 3 : 2;
}

function liftTrace(t: TraceSpec, three: boolean): TraceSpec {
  if (!three) return t;
  if (t.kind === "line2d" && t.x && t.y) {
    return { ...t, kind: "line3d", z: t.z ?? new Float64Array(t.x.length) };
  }
  if (t.kind === "scatter2d" && t.x && t.y) {
    return { ...t, kind: "scatter3d", z: t.z ?? new Float64Array(t.x.length) };
  }
  return t;
}

function seriesFromTraces(traces: readonly TraceSpec[], three: boolean): Series[] {
  const out: Series[] = [];
  for (const t of traces) {
    if (t.x && t.y) {
      out.push({
        x: t.x,
        y: t.y,
        z: three ? (t.z ?? new Float64Array(t.x.length)) : (t.z ?? null),
      });
    }
  }
  return out;
}

function failPlot(msg: string): never {
  throw new CalcError(msg);
}

export class Figures {
  #slots = new Map<number, FigureSlot>();
  #current = 0;
  #makeError: (msg: string) => Error;

  constructor(makeError?: (msg: string) => Error) {
    this.#makeError = makeError ?? ((msg) => new CalcError(msg));
  }

  #fail(msg: string): never {
    throw this.#makeError(msg);
  }

  #makeAxes(rows: number, cols: number, index: number): AxesSlot {
    const zero = index - 1;
    const row = Math.floor(zero / cols) + 1;
    const col = (zero % cols) + 1;
    return {
      hold: false,
      spec: {
        row,
        col,
        index,
        dims: 2,
        traces: [],
      },
    };
  }

  #open(id: number): FigureSlot {
    let slot = this.#slots.get(id);
    if (!slot) {
      if (this.#slots.size >= MAX_FIGURES) this.#fail(`at most ${MAX_FIGURES} figures`);
      const axes = new Map<number, AxesSlot>();
      axes.set(1, this.#makeAxes(1, 1, 1));
      slot = { rows: 1, cols: 1, activeIndex: 1, axes };
      this.#slots.set(id, slot);
    }
    return slot;
  }

  #activeFigure(): FigureSlot {
    if (this.#current === 0) this.figure();
    return this.#slots.get(this.#current) as FigureSlot;
  }

  #activeAxes(): AxesSlot {
    const fig = this.#activeFigure();
    let ax = fig.axes.get(fig.activeIndex);
    if (!ax) {
      ax = this.#makeAxes(fig.rows, fig.cols, fig.activeIndex);
      fig.axes.set(fig.activeIndex, ax);
    }
    return ax;
  }

  figure(id?: number): void {
    if (id === undefined) {
      let next = 1;
      for (const k of this.#slots.keys()) next = Math.max(next, k + 1);
      id = next;
    }
    if (!Number.isInteger(id) || id < 1) this.#fail("figure needs a whole number from 1");
    this.#open(id);
    this.#current = id;
  }

  clf(): void {
    const fig = this.#activeFigure();
    fig.rows = 1;
    fig.cols = 1;
    fig.activeIndex = 1;
    fig.axes.clear();
    fig.axes.set(1, this.#makeAxes(1, 1, 1));
  }

  subplot(rows: number, cols: number, index: number): void {
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      !Number.isInteger(index) ||
      rows < 1 ||
      cols < 1 ||
      index < 1 ||
      index > rows * cols
    ) {
      this.#fail("subplot needs valid row, column, and index");
    }
    if (rows * cols > 16) this.#fail("at most 16 subplots per figure");
    const fig = this.#activeFigure();
    if (fig.rows !== rows || fig.cols !== cols) {
      fig.axes.clear();
      fig.rows = rows;
      fig.cols = cols;
    }
    fig.activeIndex = index;
    if (!fig.axes.has(index)) {
      fig.axes.set(index, this.#makeAxes(rows, cols, index));
    }
  }

  hold(on?: boolean): void {
    const ax = this.#activeAxes();
    ax.hold = on ?? !ax.hold;
  }

  plot(series: Series[], styles?: (LineStyleSpec | undefined)[]): void {
    const traces: TraceSpec[] = series.map((s, i) => {
      if (s.x.length > MAX_POINTS) {
        this.#fail(`too many points (${s.x.length}, max ${MAX_POINTS})`);
      }
      return s.z !== null
        ? { kind: "line3d", x: s.x, y: s.y, z: s.z, style: styles?.[i] }
        : { kind: "line2d", x: s.x, y: s.y, style: styles?.[i] };
    });
    this.addTraces(traces);
  }

  addTraces(traces: TraceSpec[], opts?: { xscale?: "linear" | "log"; yscale?: "linear" | "log" }): void {
    for (const t of traces) {
      const len = Math.max(t.x?.length ?? 0, t.y?.length ?? 0, t.z?.length ?? 0, t.matrix?.data.length ?? 0);
      const cap = t.matrix ? MAX_POINTS * 5 : MAX_POINTS;
      if (len > cap) {
        this.#fail(`too many points (${len}, max ${cap})`);
      }
    }
    const ax = this.#activeAxes();
    const base = ax.hold ? ax.spec.traces : [];
    if (!ax.hold) {
      ax.spec = {
        ...this.#makeAxes(this.#activeFigure().rows, this.#activeFigure().cols, ax.spec.index).spec,
        title: ax.spec.title,
        xlabel: ax.spec.xlabel,
        ylabel: ax.spec.ylabel,
        zlabel: ax.spec.zlabel,
        grid: ax.spec.grid,
        box: ax.spec.box,
        colormap: ax.spec.colormap,
        colorbar: ax.spec.colorbar,
      };
    }
    const three = traceDims(base) === 3 || traceDims(traces) === 3;
    ax.spec.dims = three ? 3 : 2;
    ax.spec.traces = [...base, ...traces].map((t) => liftTrace(t, three));
    if (opts?.xscale) ax.spec.xscale = opts.xscale;
    if (opts?.yscale) ax.spec.yscale = opts.yscale;
  }

  mutateAxes(fn: (spec: SubplotSpec) => void): void {
    const ax = this.#activeAxes();
    fn(ax.spec);
  }

  list(): Figure[] {
    return [...this.#slots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, slot]) => {
        const subplots = [...slot.axes.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, ax]) => ({
            ...ax.spec,
            traces: [...ax.spec.traces],
          }));
        const anyThree = subplots.some((sp) => sp.dims === 3);
        const series: Series[] = [];
        for (const sp of subplots) {
          series.push(...seriesFromTraces(sp.traces, sp.dims === 3));
        }
        return {
          id,
          dims: anyThree ? 3 : 2,
          series,
          rows: slot.rows,
          cols: slot.cols,
          subplots,
        };
      });
  }
}
