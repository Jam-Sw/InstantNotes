import { afterEach, describe, expect, it, vi } from "vitest";
import { attachControls, type Camera } from "./controls";
import { FRONT } from "./projection";

function makeElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      right: 510,
      bottom: 320,
      width: 500,
      height: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function ptr(type: string, init: PointerEventInit & { pointerId?: number; pointerType?: string } = {}): PointerEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
  }) as PointerEvent;
  Object.defineProperty(ev, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(ev, "pointerType", { value: init.pointerType ?? "mouse" });
  return ev;
}

describe("attachControls cross-platform interactions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lets plain wheel scroll the note when ctrlWheel is enabled, and zooms on Ctrl+wheel or macOS Cmd+wheel", () => {
    const el = makeElement();
    let cam: Camera = { orbit: FRONT, view: { x: 0, y: 0, k: 1 } };
    const detach = attachControls(el, {
      mode: "2d",
      ctrlWheel: true,
      camera: () => cam,
      update: (next) => (cam = next),
    });

    const plain = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, clientX: 110, clientY: 120 });
    el.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(cam.view.k).toBe(1);

    const ctrl = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      ctrlKey: true,
      clientX: 110,
      clientY: 120,
    });
    el.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(true);
    expect(cam.view.k).toBeGreaterThan(1);

    const afterCtrl = cam.view.k;
    const cmd = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      metaKey: true,
      clientX: 110,
      clientY: 120,
    });
    el.dispatchEvent(cmd);
    expect(cmd.defaultPrevented).toBe(true);
    expect(cam.view.k).toBeLessThan(afterCtrl);

    detach();
  });

  it("supports WebKit gesturestart/gesturechange trackpad pinch without double-zooming 2-finger touch", () => {
    const el = makeElement();
    let cam: Camera = { orbit: FRONT, view: { x: 0, y: 0, k: 1 } };
    const detach = attachControls(el, {
      mode: "2d",
      ctrlWheel: true,
      camera: () => cam,
      update: (next) => (cam = next),
    });

    const gs = new Event("gesturestart", { bubbles: true, cancelable: true });
    Object.assign(gs, { scale: 1, clientX: 260, clientY: 170 });
    el.dispatchEvent(gs);
    expect(gs.defaultPrevented).toBe(true);

    const gc = new Event("gesturechange", { bubbles: true, cancelable: true });
    Object.assign(gc, { scale: 1.5, clientX: 260, clientY: 170 });
    el.dispatchEvent(gc);
    expect(gc.defaultPrevented).toBe(true);
    expect(cam.view.k).toBeCloseTo(1.5, 5);

    el.dispatchEvent(ptr("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 }));
    el.dispatchEvent(ptr("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 100 }));
    const beforeTouchGesture = cam.view.k;
    const gcTouch = new Event("gesturechange", { bubbles: true, cancelable: true });
    Object.assign(gcTouch, { scale: 2.5, clientX: 150, clientY: 100 });
    el.dispatchEvent(gcTouch);
    expect(cam.view.k).toBe(beforeTouchGesture);

    detach();
  });

  it("does not leak ghost pointers when pointer releases outside element before exceeding TAP_SLOP", () => {
    const el = makeElement();
    let cam: Camera = { orbit: FRONT, view: { x: 0, y: 0, k: 1 } };
    const detach = attachControls(el, {
      mode: "2d",
      camera: () => cam,
      update: (next) => (cam = next),
    });

    el.dispatchEvent(ptr("pointerdown", { pointerId: 10, clientX: 50, clientY: 50 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 10, clientX: 52, clientY: 52 }));

    el.dispatchEvent(ptr("pointerdown", { pointerId: 11, clientX: 100, clientY: 100 }));
    window.dispatchEvent(ptr("pointermove", { pointerId: 11, clientX: 140, clientY: 130 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 11, clientX: 140, clientY: 130 }));

    expect(cam.view.k).toBe(1);
    expect(cam.view.x).toBe(40);
    expect(cam.view.y).toBe(30);

    detach();
  });

  it("orbits on primary drag in 3D, pans on Shift+drag or macOS Ctrl+click drag, and pinches with 2 touch fingers", () => {
    const el = makeElement();
    let cam: Camera = { orbit: FRONT, view: { x: 0, y: 0, k: 1 } };
    const detach = attachControls(el, {
      mode: "3d",
      camera: () => cam,
      update: (next) => (cam = next),
    });

    el.dispatchEvent(ptr("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 }));
    window.dispatchEvent(ptr("pointermove", { pointerId: 1, clientX: 150, clientY: 120 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 1, clientX: 150, clientY: 120 }));
    expect(cam.orbit).not.toEqual(FRONT);
    expect(cam.view.x).toBe(0);

    el.dispatchEvent(ptr("pointerdown", { pointerId: 2, clientX: 100, clientY: 100, ctrlKey: true, pointerType: "mouse" }));
    window.dispatchEvent(ptr("pointermove", { pointerId: 2, clientX: 130, clientY: 115, ctrlKey: true, pointerType: "mouse" }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 2, clientX: 130, clientY: 115 }));
    expect(cam.view.x).toBe(30);
    expect(cam.view.y).toBe(15);

    el.dispatchEvent(ptr("pointerdown", { pointerId: 3, pointerType: "touch", clientX: 110, clientY: 120 }));
    el.dispatchEvent(ptr("pointerdown", { pointerId: 4, pointerType: "touch", clientX: 210, clientY: 120 }));
    window.dispatchEvent(ptr("pointermove", { pointerId: 4, pointerType: "touch", clientX: 310, clientY: 120 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 3, pointerType: "touch", clientX: 110, clientY: 120 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 4, pointerType: "touch", clientX: 310, clientY: 120 }));
    expect(cam.view.k).toBeCloseTo(2, 5);

    detach();
  });

  it("fires doubleTap on touch double-tap", () => {
    const el = makeElement();
    const cam: Camera = { orbit: FRONT, view: { x: 0, y: 0, k: 1 } };
    const onDoubleTap = vi.fn();
    const detach = attachControls(el, {
      mode: "2d",
      camera: () => cam,
      update: () => {},
      doubleTap: onDoubleTap,
    });

    el.dispatchEvent(ptr("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 120, clientY: 120 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 1, pointerType: "touch", clientX: 121, clientY: 120 }));
    expect(onDoubleTap).not.toHaveBeenCalled();

    el.dispatchEvent(ptr("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 122, clientY: 121 }));
    window.dispatchEvent(ptr("pointerup", { pointerId: 2, pointerType: "touch", clientX: 122, clientY: 121 }));
    expect(onDoubleTap).toHaveBeenCalledTimes(1);

    detach();
  });
});
