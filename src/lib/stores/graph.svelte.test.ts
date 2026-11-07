import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./graph.svelte");
  return mod.graphPrefs;
}

function stored(values: Record<string, unknown>) {
  mockGetSetting.mockImplementation(async (key: string) => values[key]);
}

beforeEach(() => {
  vi.resetModules();
  mockGetSetting.mockReset().mockResolvedValue(undefined);
  mockSetSetting.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("graphPrefs", () => {
  it("defaults to today's graph", async () => {
    const prefs = await load();
    await prefs.init();
    expect([prefs.labels, prefs.nodeSize, prefs.spread, prefs.lensHops]).toEqual([
      "focus",
      1,
      1,
      2,
    ]);
  });

  it("reads stored values on init", async () => {
    stored({
      "graph.labels": "all",
      "graph.nodeSize": 1.5,
      "graph.spread": 0.7,
      "graph.lensHops": 3,
    });
    const prefs = await load();
    await prefs.init();
    expect([prefs.labels, prefs.nodeSize, prefs.spread, prefs.lensHops]).toEqual([
      "all",
      1.5,
      0.7,
      3,
    ]);
  });

  it("ignores invalid stored values", async () => {
    stored({
      "graph.labels": "some",
      "graph.nodeSize": 5,
      "graph.spread": 0,
      "graph.lensHops": 4,
    });
    const prefs = await load();
    await prefs.init();
    expect([prefs.labels, prefs.nodeSize, prefs.spread, prefs.lensHops]).toEqual([
      "focus",
      1,
      1,
      2,
    ]);
  });

  it("keeps a value set before init finishes", async () => {
    stored({ "graph.labels": "all" });
    const prefs = await load();
    const loading = prefs.init();
    prefs.setLabels("none");
    await loading;
    expect(prefs.labels).toBe("none");
  });

  it("saves each setter under its own key and clamps the scales", async () => {
    const prefs = await load();
    prefs.setLabels("none");
    prefs.setNodeSize(9);
    prefs.setSpread(0.1);
    prefs.setLensHops(3);
    expect(mockSetSetting).toHaveBeenCalledWith("graph.labels", "none");
    expect(mockSetSetting).toHaveBeenCalledWith("graph.nodeSize", 2);
    expect(mockSetSetting).toHaveBeenCalledWith("graph.spread", 0.5);
    expect(mockSetSetting).toHaveBeenCalledWith("graph.lensHops", 3);
  });

  it("falls back to defaults when the settings read fails", async () => {
    mockGetSetting.mockRejectedValue(new Error("no backend"));
    const prefs = await load();
    await expect(prefs.init()).resolves.toBeUndefined();
    expect(prefs.lensHops).toBe(2);
  });
});

describe("GRAPH_DEFAULTS defaults", () => {
  it("starts every field at its default", async () => {
    const mod = await import("./graph.svelte");
    const { GRAPH_DEFAULTS, graphPrefs } = mod;
    const expected = { labels: "focus", nodeSize: 1, spread: 1, lensHops: 2 };
    expect(GRAPH_DEFAULTS).toEqual(expected);
    for (const [k, v] of Object.entries(expected)) expect(graphPrefs[k as keyof typeof expected]).toBe(v);
  });
});
