import { clampZoom, pinch, turn, wheelKind, zoomAt, type Orbit, type View, type WheelKind } from "./projection";

const TAP_SLOP = 5;
const WHEEL_GAP_MS = 200;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 24;

export interface Camera {
  orbit: Orbit;
  view: View;
}

export interface ControlOptions {
  mode: "2d" | "3d";
  ctrlWheel?: boolean;
  camera(): Camera;
  update(next: Camera): void;
  touch?(kind: "orbit" | "view"): void;
  drag?(state: { dragged: boolean; grabbing: boolean }): void;
  tap?(e: PointerEvent): void;
  doubleTap?(e: PointerEvent): void;
}

interface WebKitGestureEvent extends UIEvent {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function attachControls(el: HTMLElement, options: ControlOptions): () => void {
  const { mode, ctrlWheel, camera, update, touch, drag, tap, doubleTap } = options;
  const pointers = new Map<number, { x: number; y: number }>();
  const captured = new Set<number>();
  let windowListening = false;
  let pressedAt = { x: 0, y: 0 };
  let panning = false;
  let dragged = false;
  let grabbing = false;
  let wheelLatch: { kind: WheelKind; at: number } | null = null;
  let lastGestureScale = 1;
  let lastTap: { at: number; x: number; y: number; pointerType: string } | null = null;

  const report = () => drag?.({ dragged, grabbing });

  function local(e: { clientX: number; clientY: number }) {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function capturePointer(id: number) {
    try {
      el.setPointerCapture?.(id);
      captured.add(id);
    } catch {
    }
  }

  function releaseCapture(id: number) {
    if (!captured.delete(id)) return;
    try {
      if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    } catch {
    }
  }

  function syncWindowListeners() {
    const need = pointers.size > 0;
    if (need === windowListening || typeof window === "undefined") return;
    windowListening = need;
    if (need) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", release);
      window.addEventListener("blur", clearAllPointers);
    } else {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", clearAllPointers);
    }
  }

  function clearAllPointers() {
    if (pointers.size === 0 && !grabbing) return;
    for (const id of [...captured]) releaseCapture(id);
    pointers.clear();
    captured.clear();
    grabbing = false;
    syncWindowListeners();
    report();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button > 2) return;
    const at = local(e);
    pointers.set(e.pointerId, at);
    syncWindowListeners();
    if (pointers.size === 1) {
      pressedAt = at;
      panning =
        mode === "2d" ||
        e.button !== 0 ||
        e.shiftKey ||
        (e.ctrlKey && e.pointerType === "mouse");
      dragged = false;
    } else {
      dragged = true;
      grabbing = true;
      for (const id of pointers.keys()) capturePointer(id);
    }
    report();
  }

  function onPointerMove(e: PointerEvent) {
    const before = pointers.get(e.pointerId);
    if (!before) return;
    const at = local(e);
    const { orbit, view } = camera();
    if (pointers.size >= 2) {
      const ids = [...pointers.keys()].slice(0, 2);
      if (!ids.includes(e.pointerId)) return;
      const pair = () => ids.map((id) => pointers.get(id)!) as [typeof at, typeof at];
      const was = pair();
      pointers.set(e.pointerId, at);
      touch?.("view");
      update({ orbit, view: pinch(view, was, pair()) });
      return;
    }
    pointers.set(e.pointerId, at);
    if (!dragged) {
      if (Math.hypot(at.x - pressedAt.x, at.y - pressedAt.y) < TAP_SLOP) return;
      dragged = true;
      grabbing = true;
      capturePointer(e.pointerId);
      report();
    }
    const dx = at.x - before.x;
    const dy = at.y - before.y;
    if (panning) {
      touch?.("view");
      update({ orbit, view: { ...view, x: view.x + dx, y: view.y + dy } });
    } else {
      touch?.("orbit");
      update({ orbit: turn(orbit, dx, dy), view });
    }
  }

  function release(e: PointerEvent) {
    releaseCapture(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) grabbing = false;
    if (pointers.size === 1) panning = mode === "2d";
    syncWindowListeners();
    report();
  }

  function onLostCapture(e: PointerEvent) {
    if (!captured.delete(e.pointerId)) return;
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) grabbing = false;
    if (pointers.size === 1) panning = mode === "2d";
    syncWindowListeners();
    report();
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const tapped = !dragged && pointers.size === 1;
    const at = local(e);
    release(e);
    if (!tapped) return;
    tap?.(e);
    if (doubleTap && (e.button === 0 || e.pointerType === "touch")) {
      const now = Date.now();
      if (
        lastTap &&
        lastTap.pointerType === e.pointerType &&
        now - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < DOUBLE_TAP_SLOP
      ) {
        lastTap = null;
        doubleTap(e);
      } else {
        lastTap = { at: now, x: at.x, y: at.y, pointerType: e.pointerType };
      }
    }
  }

  function onWheel(e: WheelEvent) {
    const modZoom = e.ctrlKey || (ctrlWheel === true && e.metaKey);
    if (ctrlWheel && !modZoom) return;
    e.preventDefault();
    touch?.("view");
    const { orbit, view } = camera();
    const latched = wheelLatch && e.timeStamp - wheelLatch.at < WHEEL_GAP_MS ? wheelLatch.kind : null;
    const kind = modZoom ? "zoom" : (latched ?? wheelKind(e));
    wheelLatch = { kind, at: e.timeStamp };
    if (kind === "pan") {
      update({ orbit, view: { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY } });
      return;
    }
    const { x, y } = local(e);
    const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const delta = e.deltaY * lines;
    const rate = modZoom ? (ctrlWheel && Math.abs(delta) >= 40 ? 0.004 : 0.01) : 0.002;
    const factor = Math.exp(-delta * rate);
    update({ orbit, view: zoomAt(view, clampZoom(view.k * factor), x, y) });
  }

  function onGestureStart(ev: Event) {
    const e = ev as WebKitGestureEvent;
    e.preventDefault();
    lastGestureScale = e.scale > 0 ? e.scale : 1;
  }

  function onGestureChange(ev: Event) {
    const e = ev as WebKitGestureEvent;
    e.preventDefault();
    if (pointers.size >= 2) return;
    if (!(e.scale > 0) || !(lastGestureScale > 0)) return;
    const ratio = e.scale / lastGestureScale;
    lastGestureScale = e.scale;
    if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 1e-4) return;
    touch?.("view");
    const { orbit, view } = camera();
    const { x, y } = local(e);
    update({ orbit, view: zoomAt(view, clampZoom(view.k * ratio), x, y) });
  }

  function onGestureEnd(ev: Event) {
    ev.preventDefault();
    lastGestureScale = 1;
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("lostpointercapture", onLostCapture);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("gesturestart", onGestureStart, { passive: false });
  el.addEventListener("gesturechange", onGestureChange, { passive: false });
  el.addEventListener("gestureend", onGestureEnd, { passive: false });

  return () => {
    clearAllPointers();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("lostpointercapture", onLostCapture);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("gesturestart", onGestureStart);
    el.removeEventListener("gesturechange", onGestureChange);
    el.removeEventListener("gestureend", onGestureEnd);
  };
}
