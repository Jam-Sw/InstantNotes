import { beforeEach, describe, expect, it, vi } from "vitest";

const stopWorker = vi.fn();
vi.mock("./core", () => ({ stopWorker: () => stopWorker() }));

type Held = { reject: (e: unknown) => void };
let holder: Held | null;

function fakeLocks() {
  return {
    request: (_name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: object | null) => unknown) => {
      if (options.steal) {
        holder?.reject(new DOMException("stolen", "AbortError"));
        holder = null;
      }
      if (options.ifAvailable && holder) return Promise.resolve(callback(null));
      return new Promise((_, reject) => {
        holder = { reject };
        void callback({});
      });
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  stopWorker.mockReset();
  holder = null;
  vi.stubGlobal("navigator", { locks: fakeLocks() });
  vi.stubGlobal("location", { reload: vi.fn() });
});

describe("one tab at a time", () => {
  it("lets the first tab in and keeps a second one out", async () => {
    const first = (await import("./tab.svelte")).tab;
    expect(await first.claim()).toBe(true);
    vi.resetModules();
    const second = (await import("./tab.svelte")).tab;
    expect(await second.claim()).toBe(false);
    expect(second.elsewhere).toBe(true);
  });

  it("stops the first tab when another one takes the library", async () => {
    const first = (await import("./tab.svelte")).tab;
    await first.claim();
    vi.resetModules();
    const second = (await import("./tab.svelte")).tab;
    second.useHere();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopWorker).toHaveBeenCalledOnce();
    expect(first.elsewhere).toBe(true);
    expect(location.reload).toHaveBeenCalledOnce();
  });
});
