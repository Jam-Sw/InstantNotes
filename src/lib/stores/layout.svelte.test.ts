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
  window.innerWidth = next;
  for (const [query, q] of queries) {
    q.matches = matches(query);
    for (const listener of q.listeners) listener();
  }
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  vi.resetModules();
  queries.clear();
  width = 1440;
  coarse = false;
  window.innerWidth = 1440;
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

describe("width class", () => {
  it("is large from 1200, expanded from 840, medium from 600 and compact below", async () => {
    const { layout, stop } = await load();
    const seen = (w: number) => {
      resize(w);
      return layout.widthClass;
    };
    expect(layout.widthClass).toBe("large");
    expect(seen(1200)).toBe("large");
    expect(seen(1199)).toBe("expanded");
    expect(seen(840)).toBe("expanded");
    expect(seen(839)).toBe("medium");
    expect(seen(600)).toBe("medium");
    expect(seen(599)).toBe("compact");
    expect(seen(1440)).toBe("large");
    stop();
  });

  it("tracks the window width", async () => {
    const { layout, stop } = await load();
    resize(1100);
    expect(layout.width).toBe(1100);
    stop();
  });

  it("keeps the old phone, tablet and desktop mode for the code that asks", async () => {
    const { layout, stop } = await load();
    expect(layout.mode).toBe("desktop");
    resize(1000);
    expect(layout.mode).toBe("tablet");
    resize(600);
    expect(layout.mode).toBe("tablet");
    resize(599);
    expect(layout.mode).toBe("phone");
    expect(layout.phone).toBe(true);
    resize(1200);
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

describe("the compact stack's panes", () => {
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

describe("pane widths", () => {
  it("clamps to each pane's range", async () => {
    const { clampPane, NAV_PANE, LIST_PANE } = await import("./layout.svelte");
    expect([NAV_PANE.min, NAV_PANE.def, NAV_PANE.max]).toEqual([180, 220, 300]);
    expect([LIST_PANE.min, LIST_PANE.def, LIST_PANE.max]).toEqual([240, 300, 420]);
    expect(clampPane(NAV_PANE, 100)).toBe(180);
    expect(clampPane(NAV_PANE, 250.4)).toBe(250);
    expect(clampPane(NAV_PANE, 900)).toBe(300);
    expect(clampPane(LIST_PANE, 100)).toBe(240);
    expect(clampPane(LIST_PANE, 900)).toBe(420);
  });

  it("snaps a pane collapsed below half its minimum", async () => {
    const { dragWidth, NAV_PANE, LIST_PANE } = await import("./layout.svelte");
    expect(dragWidth(NAV_PANE, 89)).toEqual({ width: 180, collapsed: true });
    expect(dragWidth(NAV_PANE, 90)).toEqual({ width: 180, collapsed: false });
    expect(dragWidth(NAV_PANE, 150)).toEqual({ width: 180, collapsed: false });
    expect(dragWidth(NAV_PANE, 260)).toEqual({ width: 260, collapsed: false });
    expect(dragWidth(NAV_PANE, 999)).toEqual({ width: 300, collapsed: false });
    expect(dragWidth(LIST_PANE, 119)).toEqual({ width: 240, collapsed: true });
    expect(dragWidth(LIST_PANE, 120)).toEqual({ width: 240, collapsed: false });
    expect(dragWidth(LIST_PANE, 999)).toEqual({ width: 420, collapsed: false });
  });

  it("stops a drag where the editor would drop below its minimum", async () => {
    const { dragWidth, LIST_PANE } = await import("./layout.svelte");
    expect(dragWidth(LIST_PANE, 400, 300)).toEqual({ width: 300, collapsed: false });
    expect(dragWidth(LIST_PANE, 400, 100)).toEqual({ width: 240, collapsed: false });
  });

  it("moves 16px a key press inside the range", async () => {
    const { stepWidth, NAV_PANE, LIST_PANE } = await import("./layout.svelte");
    expect(stepWidth(NAV_PANE, 220, 1)).toBe(236);
    expect(stepWidth(NAV_PANE, 220, -1)).toBe(204);
    expect(stepWidth(NAV_PANE, 190, -1)).toBe(180);
    expect(stepWidth(NAV_PANE, 295, 1)).toBe(300);
    expect(stepWidth(LIST_PANE, 300, 1)).toBe(316);
    expect(stepWidth(LIST_PANE, 410, 1)).toBe(420);
    expect(stepWidth(LIST_PANE, 300, 1, 305)).toBe(305);
  });
});

describe("which panes sit beside the editor", () => {
  it("follows the chosen state on a large window", async () => {
    const { resolveLayout } = await import("./layout.svelte");
    expect(resolveLayout("large", "all", 1440, 220, 300)).toEqual({ nav: true, list: true });
    expect(resolveLayout("large", "double", 1440, 220, 300)).toEqual({ nav: false, list: true });
    expect(resolveLayout("large", "detail", 1440, 220, 300)).toEqual({ nav: false, list: false });
  });

  it("keeps the nav in its drawer on an expanded window", async () => {
    const { resolveLayout } = await import("./layout.svelte");
    expect(resolveLayout("expanded", "all", 1000, 220, 300)).toEqual({ nav: false, list: true });
    expect(resolveLayout("expanded", "double", 1000, 220, 300)).toEqual({ nav: false, list: true });
    expect(resolveLayout("expanded", "detail", 1000, 220, 300)).toEqual({ nav: false, list: false });
  });

  it("keeps both in drawers on a medium or compact window", async () => {
    const { resolveLayout } = await import("./layout.svelte");
    expect(resolveLayout("medium", "all", 700, 220, 300)).toEqual({ nav: false, list: false });
    expect(resolveLayout("compact", "all", 500, 220, 300)).toEqual({ nav: false, list: false });
  });

  it("yields the nav first, then the list, so the editor keeps 420", async () => {
    const { resolveLayout } = await import("./layout.svelte");
    expect(resolveLayout("large", "all", 940, 220, 300)).toEqual({ nav: true, list: true });
    expect(resolveLayout("large", "all", 939, 220, 300)).toEqual({ nav: false, list: true });
    expect(resolveLayout("large", "all", 720, 220, 300)).toEqual({ nav: false, list: true });
    expect(resolveLayout("large", "all", 719, 220, 300)).toEqual({ nav: false, list: false });
    expect(resolveLayout("expanded", "double", 719, 220, 300)).toEqual({ nav: false, list: false });
    expect(resolveLayout("large", "all", 1200, 300, 420)).toEqual({ nav: true, list: true });
  });
});

describe("layout shortcuts", () => {
  const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
    ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

  it("keeps Cmd or Ctrl+\\ on the nav and Cmd or Ctrl+Shift+L on the note list", async () => {
    const { layoutShortcut } = await import("./layout.svelte");
    for (const mac of [true, false]) {
      expect(layoutShortcut(key("\\", { metaKey: true }), mac)).toBe("nav");
      expect(layoutShortcut(key("\\", { ctrlKey: true }), mac)).toBe("nav");
      expect(layoutShortcut(key("L", { metaKey: true, shiftKey: true }), mac)).toBe("list");
      expect(layoutShortcut(key("l", { ctrlKey: true, shiftKey: true }), mac)).toBe("list");
      expect(layoutShortcut(key("\\"), mac)).toBeNull();
      expect(layoutShortcut(key("l", { metaKey: true }), mac)).toBeNull();
    }
  });

  it("adds Ctrl+Cmd+S for the nav on macOS only", async () => {
    const { layoutShortcut } = await import("./layout.svelte");
    const chord = key("s", { metaKey: true, ctrlKey: true });
    expect(layoutShortcut(chord, true)).toBe("nav");
    expect(layoutShortcut(chord, false)).toBeNull();
    expect(layoutShortcut(key("s", { metaKey: true }), true)).toBeNull();
    expect(layoutShortcut(key("s", { ctrlKey: true }), true)).toBeNull();
    expect(layoutShortcut(key("s", { ctrlKey: true, altKey: true }), false)).toBeNull();
  });
});
