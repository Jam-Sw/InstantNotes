import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Query = { matches: boolean; listeners: Set<() => void> };

let width = 1440;
let coarse = false;
const queries = new Map<string, Query>();

function matches(query: string): boolean {
  if (query === "(pointer: coarse)") return coarse;
  const max = /max-width: (\d+)px/.exec(query);
  return max ? width <= Number(max[1]) : false;
}

function resize(next: number, touch = coarse): void {
  width = next;
  coarse = touch;
  for (const [query, q] of queries) {
    q.matches = matches(query);
    for (const listener of q.listeners) listener();
  }
}

beforeEach(() => {
  vi.resetModules();
  queries.clear();
  width = 1440;
  coarse = false;
  window.matchMedia = vi.fn((query: string) => {
    const q = queries.get(query) ?? { matches: matches(query), listeners: new Set() };
    queries.set(query, q);
    return {
      get matches() {
        return q.matches;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => q.listeners.add(l),
      removeEventListener: (_: string, l: () => void) => q.listeners.delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.touch;
  delete document.documentElement.dataset.layout;
});

async function load() {
  const { layout } = await import("./layout.svelte");
  const stop = layout.init(window);
  return { layout, stop };
}

describe("layout mode", () => {
  it("is the desktop above 960px, the tablet down to 600px and the phone below", async () => {
    const { layout, stop } = await load();
    expect(layout.mode).toBe("desktop");
    resize(820);
    expect(layout.mode).toBe("tablet");
    resize(600);
    expect(layout.mode).toBe("tablet");
    resize(599);
    expect(layout.mode).toBe("phone");
    resize(961);
    expect(layout.mode).toBe("desktop");
    stop();
  });

  it("marks the page as touch under a coarse pointer", async () => {
    const { layout, stop } = await load();
    expect(layout.touch).toBe(false);
    expect(document.documentElement.dataset.touch).toBeUndefined();
    resize(390, true);
    expect(layout.touch).toBe(true);
    expect(document.documentElement.dataset.touch).toBe("");
    expect(document.documentElement.dataset.layout).toBe("phone");
    stop();
  });
});

describe("the phone's panes", () => {
  it("opens a note as a history entry and goes back to the list on the browser's back", async () => {
    resize(390, true);
    const { layout, stop } = await load();
    const left = vi.fn();
    layout.onLeave = left;
    const push = vi.spyOn(history, "pushState");
    layout.showNote();
    expect(layout.pane).toBe("note");
    expect(push).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(layout.pane).toBe("list");
    expect(left).toHaveBeenCalledTimes(1);
    stop();
  });

  it("goes back through the history so the back gesture stays in step", async () => {
    resize(390, true);
    const { layout, stop } = await load();
    const back = vi.spyOn(history, "back").mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    layout.showNote();
    layout.back();
    expect(back).toHaveBeenCalledTimes(1);
    expect(layout.pane).toBe("list");
    stop();
  });

  it("keeps one pane only on the phone", async () => {
    const { layout, stop } = await load();
    layout.showNote();
    expect(layout.pane).toBe("list");
    stop();
  });

  it("returns to the list when the window grows past the phone", async () => {
    resize(390, true);
    const { layout, stop } = await load();
    vi.spyOn(history, "back").mockImplementation(() => {});
    layout.showNote();
    resize(820, true);
    expect(layout.pane).toBe("list");
    stop();
  });
});
