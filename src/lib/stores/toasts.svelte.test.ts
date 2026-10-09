import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  const mod = await import("$lib/stores/toasts.svelte");
  return mod.toasts;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toasts queue", () => {
  it("show() queues a toast that auto-dismisses after ~5s", async () => {
    const toasts = await load();
    const id = toasts.show("Moved to Trash");
    expect(toasts.items.map((t) => t.id)).toEqual([id]);

    await vi.advanceTimersByTimeAsync(4999);
    expect(toasts.items).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts.items).toHaveLength(0);
  });

  it("dismiss() removes a toast immediately and cancels its timer", async () => {
    const toasts = await load();
    const id = toasts.show("Moved to Trash");
    toasts.dismiss(id);
    expect(toasts.items).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(toasts.items).toHaveLength(0);
  });

  it("pausing while hovered holds the timer; resuming continues from where it left off", async () => {
    const toasts = await load();
    const id = toasts.show("Moved to Trash");

    await vi.advanceTimersByTimeAsync(4000);
    toasts.pause(id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toasts.items).toHaveLength(1);

    toasts.resume(id);
    await vi.advanceTimersByTimeAsync(999);
    expect(toasts.items).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts.items).toHaveLength(0);
  });

  it("caps the visible stack at 3 and evicts the oldest (FIFO) past the cap", async () => {
    const toasts = await load();
    const a = toasts.show("first");
    const b = toasts.show("second");
    const c = toasts.show("third");
    expect(toasts.items.map((t) => t.id)).toEqual([a, b, c]);

    const d = toasts.show("fourth");
    expect(toasts.items.map((t) => t.id)).toEqual([b, c, d]);
    expect(toasts.items).toHaveLength(3);
  });

  it("an evicted toast's timer cannot fire a stray dismiss later", async () => {
    const toasts = await load();
    toasts.show("first");
    const b = toasts.show("second");
    const c = toasts.show("third");
    const d = toasts.show("fourth");

    await vi.advanceTimersByTimeAsync(4999);
    expect(toasts.items.map((t) => t.id)).toEqual([b, c, d]);
  });

  it("activate() runs the toast's action and dismisses it", async () => {
    const toasts = await load();
    const run = vi.fn();
    const id = toasts.show("Moved to Trash", { label: "Undo", run });

    toasts.activate(id);

    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.items).toHaveLength(0);
  });

  it("activate() on a toast without an action never throws", async () => {
    const toasts = await load();
    const id = toasts.show("Trash emptied");
    expect(() => toasts.activate(id)).not.toThrow();
    expect(toasts.items).toHaveLength(0);
  });
});
