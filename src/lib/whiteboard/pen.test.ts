import { describe, expect, it } from "vitest";
import { PenGuard } from "./pen";

const ev = (pointerType: string, pointerId: number, pressure = 0.5) => ({
  pointerId,
  pointerType,
  pressure,
});

describe("PenGuard", () => {
  it("lets a pen stroke through and marks the pen as seen", () => {
    const guard = new PenGuard();
    expect(guard.seen).toBe(false);
    expect(guard.down(ev("pen", 1, 0.8))).toBe(false);
    expect(guard.move(ev("pen", 1, 0.3))).toBe(false);
    expect(guard.up(ev("pen", 1, 0))).toBe(false);
    expect(guard.seen).toBe(true);
  });

  it("rejects a palm that lands while the pen is on the glass, for its whole contact", () => {
    const guard = new PenGuard();
    guard.down(ev("pen", 1, 0.6));
    expect(guard.down(ev("touch", 2))).toBe(true);
    expect(guard.move(ev("touch", 2))).toBe(true);
    guard.up(ev("pen", 1));
    expect(guard.move(ev("touch", 2))).toBe(true);
    expect(guard.up(ev("touch", 2))).toBe(true);
    expect(guard.move(ev("touch", 2))).toBe(false);
  });

  it("lets fingers through when no pen is down, so they pan and zoom", () => {
    const guard = new PenGuard();
    expect(guard.down(ev("touch", 3))).toBe(false);
    guard.down(ev("pen", 1));
    guard.up(ev("pen", 1));
    expect(guard.down(ev("touch", 4))).toBe(false);
    expect(guard.move(ev("touch", 4))).toBe(false);
  });

  it("never rejects the mouse", () => {
    const guard = new PenGuard();
    guard.down(ev("pen", 1));
    expect(guard.down(ev("mouse", 5))).toBe(false);
  });
});
