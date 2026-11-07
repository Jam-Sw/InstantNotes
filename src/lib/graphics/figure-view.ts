import { sameFigure, type Figure } from "$lib/calc/plot";
import { attachControls, type Camera } from "./controls";
import { FRONT } from "./projection";
import { camera2d, camera3d, prepare, scene2d, scene3d, type Prepared, type Scene, type Size } from "./figure";
import {
  buildPlotlySpec,
  cameraEyeFromView,
  readPlotTheme,
  type PlotlySpecResult,
  type SubplotBinding,
} from "./plotly-spec";

const ASPECT = 0.62;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 460;
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 26;

function sizeFor(width: number, rows = 1): Size {
  const rowScale = rows > 1 ? Math.min(1.85, 1 + (rows - 1) * 0.55) : 1;
  const maxH = rows > 1 ? 680 : MAX_HEIGHT;
  return { width, height: Math.round(Math.min(maxH, Math.max(MIN_HEIGHT, width * ASPECT * rowScale))) };
}

function refit(camera: Camera, dims: 2 | 3, from: Size, to: Size): Camera {
  const { view } = camera;
  if (dims === 2) {
    return {
      orbit: camera.orbit,
      view: { k: view.k, x: (view.x * to.width) / from.width, y: (view.y * to.height) / from.height },
    };
  }
  const r = Math.min(to.width, to.height) / Math.min(from.width, from.height);
  return {
    orbit: camera.orbit,
    view: {
      k: view.k * r,
      x: to.width / 2 + (view.x - from.width / 2) * r,
      y: to.height / 2 + (view.y - from.height / 2) * r,
    },
  };
}

const SVG = "http://www.w3.org/2000/svg";

let clipSeq = 0;

const written = new WeakMap<Element, Map<string, string>>();

function set(el: Element, name: string, value: string | number): void {
  const v = String(value);
  let attrs = written.get(el);
  if (!attrs) written.set(el, (attrs = new Map()));
  if (attrs.get(name) === v) return;
  attrs.set(name, v);
  el.setAttribute(name, v);
}

function node(parent: Element, tag: string, attrs: Record<string, string> = {}): Element {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) set(el, k, v);
  parent.appendChild(el);
  return el;
}

function pool(parent: Element, tag: string, n: number, init: Record<string, string> = {}): Element[] {
  while (parent.childElementCount < n) node(parent, tag, init);
  while (parent.childElementCount > n) parent.lastElementChild!.remove();
  return Array.from(parent.children);
}

interface Layers {
  clipRect: Element;
  clipped: Element;
  frame: Element;
  lines: Element;
  labels: Element;
}

function layers(svg: SVGSVGElement, clipId: string): Layers {
  const clipRect = node(node(node(svg, "defs"), "clipPath", { id: clipId }), "rect");
  const frame = node(svg, "g", { class: "cm-figure-frame" });
  const clipped = node(svg, "g");
  const lines = node(clipped, "g", { class: "cm-figure-lines" });
  const labels = node(svg, "g", { class: "cm-figure-labels" });
  return { clipRect, clipped, frame, lines, labels };
}

function paint(svg: SVGSVGElement, at: Layers, scene: Scene, size: Size, clipId: string): void {
  set(svg, "width", size.width);
  set(svg, "height", size.height);
  set(svg, "viewBox", `0 0 ${size.width} ${size.height}`);
  if (scene.clip) {
    for (const [k, v] of Object.entries(scene.clip)) set(at.clipRect, k, v);
    set(at.clipped, "clip-path", `url(#${clipId})`);
  } else {
    set(at.clipped, "clip-path", "none");
  }
  pool(at.frame, "polyline", scene.frame.length).forEach((el, i) => {
    set(el, "points", scene.frame[i].points);
    set(el, "stroke-opacity", scene.frame[i].opacity);
  });
  set(at.lines, "transform", scene.lineTransform);
  pool(at.lines, "polyline", scene.lines.length, { "vector-effect": "non-scaling-stroke" }).forEach((el, i) => {
    const s = scene.lines[i];
    set(el, "points", s.points);
    set(el, "stroke", s.color);
    set(el, "stroke-opacity", s.opacity);
  });
  pool(at.labels, "text", scene.labels.length).forEach((el, i) => {
    const l = scene.labels[i];
    set(el, "x", l.x.toFixed(1));
    set(el, "y", l.y.toFixed(1));
    set(el, "text-anchor", l.anchor);
    if (el.textContent !== l.text) el.textContent = l.text;
  });
}

type PlotlyModule = typeof import("plotly.js-dist-min");

let plotlyPromise: Promise<PlotlyModule> | null = null;

function canUsePlotly(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof navigator !== "undefined" && /jsdom|happy-dom/i.test(navigator.userAgent)) return false;
  const probe = document.createElementNS(SVG, "text") as SVGTextElement;
  return typeof probe.getComputedTextLength === "function";
}

function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyPromise) {
    plotlyPromise = import("plotly.js-dist-min").then((m) => ("default" in m ? (m.default as PlotlyModule) : m));
  }
  return plotlyPromise;
}

interface WebKitGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface LiveSubplotState {
  binding: SubplotBinding;
  xRange?: [number, number];
  yRange?: [number, number];
  azDeg: number;
  elDeg: number;
  radius: number;
}

function figureLabel(fig: Figure): string {
  const n = fig.series.length;
  return `Figure ${fig.id}, ${fig.dims}D, ${n} ${n === 1 ? "line" : "lines"}`;
}

function isInteractiveChrome(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".modebar, .modebar-btn, .legend, .colorbar"));
}

function readLiveAxisRange(host: HTMLElement, axisKey: string, fallback?: [number, number]): [number, number] | null {
  const full = (host as unknown as { _fullLayout?: Record<string, { range?: [number, number] }> })._fullLayout;
  const r = full?.[axisKey]?.range;
  if (Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]))) {
    return [Number(r[0]), Number(r[1])];
  }
  return fallback ? [...fallback] : null;
}

export interface FigureHandle {
  readonly el: HTMLElement;
  update(figure: Figure): void;
  destroy(): void;
}

export function mountFigure(figure: Figure): FigureHandle {
  const el = document.createElement("div");
  el.className = "cm-figure";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("role", "img");
  el.append(svg);
  const clipId = `cm-figure-clip-${++clipSeq}`;
  const at = layers(svg, clipId);

  let fig = figure;
  let prep: Prepared = prepare(figure);
  let size: Size = sizeFor(480, figure.rows ?? 1);
  let camera: Camera = { orbit: FRONT, view: camera2d() };
  let moved = false;
  let frame: number | null = null;
  let detachSvgControls: () => void = () => {};
  let destroyed = false;

  let plotly: PlotlyModule | null = null;
  let plotHost: HTMLDivElement | null = null;
  let specResult: PlotlySpecResult | null = null;
  let liveSubplots: LiveSubplotState[] = [];
  let pendingRelayout: Record<string, unknown> | null = null;
  let relayoutFrame: number | null = null;
  let detachPlotlyControls: (() => void) | null = null;
  let themeObserver: MutationObserver | null = null;

  const home = () => {
    camera = fig.dims === 3 ? camera3d(size) : { orbit: FRONT, view: camera2d() };
    moved = false;
  };

  const syncAria = () => {
    el.classList.toggle("cm-figure-3d", fig.dims === 3);
    const label = figureLabel(fig);
    svg.setAttribute("aria-label", label);
    if (plotHost) plotHost.setAttribute("aria-label", label);
  };

  const drawSvg = () => {
    frame = null;
    if (plotly && plotHost) return;
    const scene =
      fig.dims === 3 ? scene3d(prep, size, camera.orbit, camera.view) : scene2d(prep, size, camera.view);
    paint(svg, at, scene, size, clipId);
  };

  const scheduleSvg = () => {
    if (plotly && plotHost) return;
    if (frame === null) frame = requestAnimationFrame(drawSvg);
  };

  const flushRelayout = () => {
    relayoutFrame = null;
    if (destroyed || !plotly || !plotHost || !pendingRelayout) return;
    const patch = pendingRelayout;
    pendingRelayout = null;
    void plotly.relayout(plotHost, patch as unknown as Parameters<PlotlyModule["relayout"]>[1]);
  };

  const queueRelayout = (patch: Record<string, unknown>) => {
    pendingRelayout = { ...(pendingRelayout ?? {}), ...patch };
    if (relayoutFrame === null) relayoutFrame = requestAnimationFrame(flushRelayout);
  };

  const initLiveSubplots = (spec: PlotlySpecResult) => {
    liveSubplots = spec.subplots.map((b) => ({
      binding: b,
      xRange: b.initialXRange ? [...b.initialXRange] : undefined,
      yRange: b.initialYRange ? [...b.initialYRange] : undefined,
      azDeg: b.azDeg,
      elDeg: b.elDeg,
      radius: b.radius,
    }));
  };

  const renderPlotly = (preserveRanges = false) => {
    if (destroyed || !plotly || !plotHost) return;
    syncAria();
    el.style.minHeight = `${size.height}px`;
    const theme = readPlotTheme(el);
    const nextSpec = buildPlotlySpec(fig, size, theme);
    if (preserveRanges && liveSubplots.length === nextSpec.subplots.length) {
      const layoutRec = nextSpec.layout as Record<string, Record<string, unknown>>;
      nextSpec.subplots.forEach((b, i) => {
        const prev = liveSubplots[i];
        if (!prev || prev.binding.kind !== b.kind) return;
        if (b.kind === "cartesian" && b.xAxisKey && b.yAxisKey) {
          const xr = readLiveAxisRange(plotHost!, b.xAxisKey, prev.xRange);
          const yr = readLiveAxisRange(plotHost!, b.yAxisKey, prev.yRange);
          if (xr && moved) {
            layoutRec[b.xAxisKey] = { ...layoutRec[b.xAxisKey], range: xr, autorange: false };
            prev.xRange = xr;
          }
          if (yr && moved) {
            layoutRec[b.yAxisKey] = { ...layoutRec[b.yAxisKey], range: yr, autorange: false };
            prev.yRange = yr;
          }
        } else if (b.kind === "scene" && b.sceneKey && moved) {
          layoutRec[b.sceneKey] = {
            ...layoutRec[b.sceneKey],
            camera: {
              eye: cameraEyeFromView(prev.azDeg, prev.elDeg, prev.radius),
              up: { x: 0, y: 0, z: 1 },
              center: { x: 0, y: 0, z: 0 },
            },
          };
        }
      });
    } else {
      initLiveSubplots(nextSpec);
    }
    specResult = nextSpec;
    void plotly.react(plotHost, nextSpec.data, nextSpec.layout, nextSpec.config);
  };

  const findSubplotAt = (clientX: number, clientY: number): LiveSubplotState | null => {
    if (liveSubplots.length === 0) return null;
    if (liveSubplots.length === 1) return liveSubplots[0];
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return liveSubplots[0];
    const nx = (clientX - rect.left) / rect.width;
    const ny = 1 - (clientY - rect.top) / rect.height;
    for (const s of liveSubplots) {
      const [x0, x1] = s.binding.domainX;
      const [y0, y1] = s.binding.domainY;
      if (nx >= x0 - 0.04 && nx <= x1 + 0.04 && ny >= y0 - 0.04 && ny <= y1 + 0.04) {
        return s;
      }
    }
    return liveSubplots[0];
  };

  const subplotPixelBox = (sub: LiveSubplotState) => {
    const rect = el.getBoundingClientRect();
    const m = (specResult?.layout.margin ?? { l: 48, r: 20, t: 24, b: 34 }) as {
      l?: number;
      r?: number;
      t?: number;
      b?: number;
    };
    const ml = m.l ?? 48;
    const mr = m.r ?? 20;
    const mt = m.t ?? 24;
    const mb = m.b ?? 34;
    const plotW = Math.max(40, rect.width - ml - mr);
    const plotH = Math.max(40, rect.height - mt - mb);
    const [dx0, dx1] = sub.binding.domainX;
    const [dy0, dy1] = sub.binding.domainY;
    const left = rect.left + ml + dx0 * plotW;
    const width = Math.max(20, (dx1 - dx0) * plotW);
    const top = rect.top + mt + (1 - dy1) * plotH;
    const height = Math.max(20, (dy1 - dy0) * plotH);
    return { left, top, width, height };
  };

  const zoomSubplotAt = (sub: LiveSubplotState, factor: number, clientX: number, clientY: number) => {
    if (!plotHost || !Number.isFinite(factor) || factor <= 0) return;
    moved = true;
    if (sub.binding.kind === "scene" && sub.binding.sceneKey) {
      sub.radius = Math.max(0.35, Math.min(12, sub.radius / factor));
      queueRelayout({
        [`${sub.binding.sceneKey}.camera.eye`]: cameraEyeFromView(sub.azDeg, sub.elDeg, sub.radius),
      });
      return;
    }
    if (sub.binding.kind === "cartesian" && sub.binding.xAxisKey && sub.binding.yAxisKey) {
      const xr = sub.xRange ?? readLiveAxisRange(plotHost, sub.binding.xAxisKey, sub.binding.initialXRange);
      const yr = sub.yRange ?? readLiveAxisRange(plotHost, sub.binding.yAxisKey, sub.binding.initialYRange);
      if (!xr || !yr) return;
      const box = subplotPixelBox(sub);
      const fx = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
      const fy = Math.max(0, Math.min(1, 1 - (clientY - box.top) / box.height));
      const scale = 1 / factor;
      const anchorX = xr[0] + fx * (xr[1] - xr[0]);
      const anchorY = yr[0] + fy * (yr[1] - yr[0]);
      const nextX: [number, number] = [anchorX - (anchorX - xr[0]) * scale, anchorX + (xr[1] - anchorX) * scale];
      const nextY: [number, number] = [anchorY - (anchorY - yr[0]) * scale, anchorY + (yr[1] - anchorY) * scale];
      sub.xRange = nextX;
      sub.yRange = nextY;
      queueRelayout({
        [`${sub.binding.xAxisKey}.range`]: nextX,
        [`${sub.binding.yAxisKey}.range`]: nextY,
      });
    }
  };

  const panSubplotBy = (sub: LiveSubplotState, dxPx: number, dyPx: number) => {
    if (!plotHost) return;
    moved = true;
    if (sub.binding.kind === "scene" && sub.binding.sceneKey) {
      sub.azDeg -= dxPx * 0.55;
      sub.elDeg = Math.max(-88, Math.min(88, sub.elDeg + dyPx * 0.55));
      queueRelayout({
        [`${sub.binding.sceneKey}.camera.eye`]: cameraEyeFromView(sub.azDeg, sub.elDeg, sub.radius),
      });
      return;
    }
    if (sub.binding.kind === "cartesian" && sub.binding.xAxisKey && sub.binding.yAxisKey) {
      const xr = sub.xRange ?? readLiveAxisRange(plotHost, sub.binding.xAxisKey, sub.binding.initialXRange);
      const yr = sub.yRange ?? readLiveAxisRange(plotHost, sub.binding.yAxisKey, sub.binding.initialYRange);
      if (!xr || !yr) return;
      const box = subplotPixelBox(sub);
      const spanX = xr[1] - xr[0];
      const spanY = yr[1] - yr[0];
      const shiftX = -(dxPx / box.width) * spanX;
      const shiftY = (dyPx / box.height) * spanY;
      const nextX: [number, number] = [xr[0] + shiftX, xr[1] + shiftX];
      const nextY: [number, number] = [yr[0] + shiftY, yr[1] + shiftY];
      sub.xRange = nextX;
      sub.yRange = nextY;
      queueRelayout({
        [`${sub.binding.xAxisKey}.range`]: nextX,
        [`${sub.binding.yAxisKey}.range`]: nextY,
      });
    }
  };

  const resetPlotlyHome = () => {
    if (!plotly || !plotHost || !specResult) return;
    moved = false;
    initLiveSubplots(specResult);
    const patch: Record<string, unknown> = {};
    for (const s of liveSubplots) {
      const b = s.binding;
      if (b.kind === "cartesian" && b.xAxisKey && b.yAxisKey) {
        if (b.initialXRange) {
          patch[`${b.xAxisKey}.range`] = [...b.initialXRange];
        } else {
          patch[`${b.xAxisKey}.autorange`] = true;
        }
        if (b.initialYRange) {
          patch[`${b.yAxisKey}.range`] = [...b.initialYRange];
        } else {
          patch[`${b.yAxisKey}.autorange`] = true;
        }
      } else if (b.kind === "scene" && b.sceneKey) {
        patch[`${b.sceneKey}.camera.eye`] = cameraEyeFromView(b.azDeg, b.elDeg, b.radius);
      }
    }
    queueRelayout(patch);
  };

  const attachPlotlyInteractions = (): (() => void) => {
    const touchPts = new Map<number, { x: number; y: number }>();
    let activeSub: LiveSubplotState | null = null;
    let touchStart = { x: 0, y: 0 };
    let touchDragged = false;
    let mouseGrabbing = false;
    let windowTouchListening = false;
    let lastGestureScale = 1;
    let lastTap: { at: number; x: number; y: number } | null = null;

    const syncGrab = () => {
      el.classList.toggle("cm-figure-grabbing", mouseGrabbing || (touchPts.size > 0 && touchDragged));
    };

    const syncTouchWindow = () => {
      const need = touchPts.size > 0;
      if (need === windowTouchListening || typeof window === "undefined") return;
      windowTouchListening = need;
      if (need) {
        window.addEventListener("pointermove", onTouchMove, { passive: false });
        window.addEventListener("pointerup", onTouchUp);
        window.addEventListener("pointercancel", onTouchCancel);
        window.addEventListener("blur", clearTouches);
      } else {
        window.removeEventListener("pointermove", onTouchMove);
        window.removeEventListener("pointerup", onTouchUp);
        window.removeEventListener("pointercancel", onTouchCancel);
        window.removeEventListener("blur", clearTouches);
      }
    };

    const clearTouches = () => {
      touchPts.clear();
      activeSub = null;
      touchDragged = false;
      syncTouchWindow();
      syncGrab();
    };

    const onWheelCapture = (e: WheelEvent) => {
      const modZoom = e.ctrlKey || e.metaKey;
      if (!modZoom) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const sub = findSubplotAt(e.clientX, e.clientY);
      if (!sub) return;
      if (plotHost && sub.binding.kind === "cartesian" && sub.binding.xAxisKey && sub.binding.yAxisKey) {
        sub.xRange = readLiveAxisRange(plotHost, sub.binding.xAxisKey, sub.xRange) ?? sub.xRange;
        sub.yRange = readLiveAxisRange(plotHost, sub.binding.yAxisKey, sub.yRange) ?? sub.yRange;
      }
      const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const delta = e.deltaY * lines;
      const rate = Math.abs(delta) < 40 ? 0.01 : 0.004;
      const factor = Math.exp(-delta * rate);
      zoomSubplotAt(sub, factor, e.clientX, e.clientY);
    };

    const onGestureStart = (ev: Event) => {
      const e = ev as WebKitGestureEvent;
      e.preventDefault();
      lastGestureScale = e.scale > 0 ? e.scale : 1;
    };

    const onGestureChange = (ev: Event) => {
      const e = ev as WebKitGestureEvent;
      e.preventDefault();
      if (touchPts.size >= 2) return;
      if (!(e.scale > 0) || !(lastGestureScale > 0)) return;
      const ratio = e.scale / lastGestureScale;
      lastGestureScale = e.scale;
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-4) return;
      const sub = findSubplotAt(e.clientX, e.clientY);
      if (sub) zoomSubplotAt(sub, ratio, e.clientX, e.clientY);
    };

    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      lastGestureScale = 1;
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      if (isInteractiveChrome(e.target)) return;
      if (e.pointerType === "mouse") {
        if (e.button === 0) {
          mouseGrabbing = true;
          moved = true;
          syncGrab();
          const up = () => {
            mouseGrabbing = false;
            syncGrab();
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
          };
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }
        return;
      }

      e.stopPropagation();
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      syncTouchWindow();
      if (touchPts.size === 1) {
        touchStart = { x: e.clientX, y: e.clientY };
        touchDragged = false;
        activeSub = findSubplotAt(e.clientX, e.clientY);
        if (plotHost && activeSub?.binding.kind === "cartesian" && activeSub.binding.xAxisKey && activeSub.binding.yAxisKey) {
          activeSub.xRange = readLiveAxisRange(plotHost, activeSub.binding.xAxisKey, activeSub.xRange) ?? activeSub.xRange;
          activeSub.yRange = readLiveAxisRange(plotHost, activeSub.binding.yAxisKey, activeSub.yRange) ?? activeSub.yRange;
        }
      } else {
        touchDragged = true;
      }
      syncGrab();
    };

    function onTouchMove(e: PointerEvent) {
      const prev = touchPts.get(e.pointerId);
      if (!prev) return;
      e.preventDefault();
      const cur = { x: e.clientX, y: e.clientY };
      if (touchPts.size >= 2) {
        const ids = [...touchPts.keys()].slice(0, 2);
        if (!ids.includes(e.pointerId)) return;
        const p0 = ids[0] === e.pointerId ? prev : touchPts.get(ids[0])!;
        const p1 = ids[1] === e.pointerId ? prev : touchPts.get(ids[1])!;
        touchPts.set(e.pointerId, cur);
        const n0 = touchPts.get(ids[0])!;
        const n1 = touchPts.get(ids[1])!;
        const oldDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const newDist = Math.hypot(n1.x - n0.x, n1.y - n0.y);
        const oldMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const newMid = { x: (n0.x + n1.x) / 2, y: (n0.y + n1.y) / 2 };
        const sub = activeSub ?? findSubplotAt(newMid.x, newMid.y);
        if (sub) {
          if (sub.binding.kind === "cartesian") {
            panSubplotBy(sub, newMid.x - oldMid.x, newMid.y - oldMid.y);
          }
          if (oldDist > 4 && newDist > 4) {
            zoomSubplotAt(sub, newDist / oldDist, newMid.x, newMid.y);
          }
        }
        return;
      }
      touchPts.set(e.pointerId, cur);
      if (!touchDragged) {
        if (Math.hypot(cur.x - touchStart.x, cur.y - touchStart.y) < TAP_SLOP) return;
        touchDragged = true;
        syncGrab();
      }
      const sub = activeSub ?? findSubplotAt(cur.x, cur.y);
      if (sub) panSubplotBy(sub, cur.x - prev.x, cur.y - prev.y);
    }

    function onTouchUp(e: PointerEvent) {
      if (!touchPts.has(e.pointerId)) return;
      const tapped = !touchDragged && touchPts.size === 1;
      touchPts.delete(e.pointerId);
      if (touchPts.size === 0) activeSub = null;
      syncTouchWindow();
      syncGrab();
      if (tapped) {
        const now = Date.now();
        if (
          lastTap &&
          now - lastTap.at < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_SLOP
        ) {
          lastTap = null;
          resetPlotlyHome();
        } else {
          lastTap = { at: now, x: e.clientX, y: e.clientY };
        }
      }
    }

    function onTouchCancel(e: PointerEvent) {
      touchPts.delete(e.pointerId);
      if (touchPts.size === 0) activeSub = null;
      syncTouchWindow();
      syncGrab();
    }

    el.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });
    el.addEventListener("pointerdown", onPointerDownCapture, { capture: true });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });

    return () => {
      clearTouches();
      el.removeEventListener("wheel", onWheelCapture, { capture: true });
      el.removeEventListener("pointerdown", onPointerDownCapture, { capture: true });
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  };

  const bindSvg = () => {
    detachSvgControls();
    syncAria();
    if (plotly && plotHost) return;
    detachSvgControls = attachControls(el, {
      mode: fig.dims === 3 ? "3d" : "2d",
      ctrlWheel: true,
      camera: () => camera,
      update: (next) => {
        camera = next;
        moved = true;
        scheduleSvg();
      },
      drag: ({ grabbing }) => {
        el.classList.toggle("cm-figure-grabbing", grabbing);
      },
      doubleTap: () => {
        home();
        scheduleSvg();
      },
    });
  };

  const onDouble = () => {
    if (plotly && plotHost) {
      resetPlotlyHome();
      return;
    }
    home();
    scheduleSvg();
  };
  el.addEventListener("dblclick", onDouble);
  const onMenu = (e: Event) => e.preventDefault();
  el.addEventListener("contextmenu", onMenu);

  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const width = Math.round(el.clientWidth);
          if (width <= 0 || width === size.width) return;
          const next = sizeFor(width, fig.rows ?? 1);
          if (moved && !plotly) camera = refit(camera, fig.dims, size, next);
          size = next;
          if (!moved && !plotly) home();
          if (plotly && plotHost) {
            renderPlotly(true);
          } else {
            drawSvg();
          }
        });
  observer?.observe(el);

  home();
  bindSvg();
  drawSvg();

  if (canUsePlotly()) {
    void loadPlotly().then((mod) => {
      if (destroyed) return;
      plotly = mod;
      const width = Math.round(el.clientWidth);
      if (width > 0) size = sizeFor(width, fig.rows ?? 1);
      detachSvgControls();
      detachSvgControls = () => {};
      svg.style.display = "none";
      plotHost = document.createElement("div");
      plotHost.className = "cm-figure-plotly";
      plotHost.setAttribute("role", "img");
      el.append(plotHost);
      detachPlotlyControls = attachPlotlyInteractions();
      renderPlotly(false);

      if (typeof MutationObserver !== "undefined" && document.documentElement) {
        themeObserver = new MutationObserver(() => {
          renderPlotly(true);
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme", "data-mode", "class", "style"],
        });
      }
    });
  }

  return {
    el,
    update(next) {
      if (sameFigure(fig, next)) return;
      const rebind = next.dims !== fig.dims || next.id !== fig.id || (next.rows ?? 1) !== (fig.rows ?? 1);
      fig = next;
      prep = prepare(next);
      size = sizeFor(size.width, fig.rows ?? 1);
      if (plotly && plotHost) {
        if (rebind) moved = false;
        renderPlotly(!rebind);
        return;
      }
      if (rebind) {
        home();
        bindSvg();
      }
      scheduleSvg();
    },
    destroy() {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (relayoutFrame !== null) cancelAnimationFrame(relayoutFrame);
      observer?.disconnect();
      themeObserver?.disconnect();
      el.removeEventListener("dblclick", onDouble);
      el.removeEventListener("contextmenu", onMenu);
      detachSvgControls();
      detachPlotlyControls?.();
      if (plotly && plotHost) {
        plotly.purge(plotHost);
      }
    },
  };
}
