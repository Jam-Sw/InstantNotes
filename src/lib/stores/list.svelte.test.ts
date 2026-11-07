import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./list.svelte");
  return mod.listPrefs;
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

describe("listPrefs", () => {
  it("defaults to today's behaviour and adds no sort to the filter", async () => {
    const prefs = await load();
    await prefs.init();
    expect([prefs.sortBy, prefs.sortOrder, prefs.previewChars, prefs.recentCount]).toEqual([
      "updatedAt",
      "desc",
      90,
      5,
    ]);
    expect(prefs.sort()).toEqual({});
  });

  it("reads stored values on init", async () => {
    stored({
      "list.sortBy": "title",
      "list.sortOrder": "asc",
      "list.previewChars": 150,
      "list.recentCount": 12,
    });
    const prefs = await load();
    await prefs.init();
    expect([prefs.sortBy, prefs.sortOrder, prefs.previewChars, prefs.recentCount]).toEqual([
      "title",
      "asc",
      150,
      12,
    ]);
    expect(prefs.sort()).toEqual({ sortBy: "title", sortOrder: "asc" });
  });

  it("loads and saves Reopen last note", async () => {
    stored({ "list.reopenLast": true });
    const prefs = await load();
    expect(prefs.reopenLast).toBe(false);
    await prefs.init();
    expect(prefs.reopenLast).toBe(true);
    prefs.setReopenLast(false);
    expect(mockSetSetting).toHaveBeenLastCalledWith("list.reopenLast", false);
  });

  it("ignores invalid stored values", async () => {
    stored({
      "list.sortBy": "size",
      "list.sortOrder": "up",
      "list.previewChars": 10,
      "list.recentCount": 99,
    });
    const prefs = await load();
    await prefs.init();
    expect([prefs.sortBy, prefs.sortOrder, prefs.previewChars, prefs.recentCount]).toEqual([
      "updatedAt",
      "desc",
      90,
      5,
    ]);
  });

  it("keeps a value set before init finishes", async () => {
    stored({ "list.sortBy": "createdAt" });
    const prefs = await load();
    const loading = prefs.init();
    prefs.setSortBy("title");
    await loading;
    expect(prefs.sortBy).toBe("title");
  });

  it("saves each setter under its own key and clamps the sliders", async () => {
    const prefs = await load();
    prefs.setSortBy("lastOpenedAt");
    prefs.setSortOrder("asc");
    prefs.setPreviewChars(1000);
    prefs.setRecentCount(1);
    expect(mockSetSetting).toHaveBeenCalledWith("list.sortBy", "lastOpenedAt");
    expect(mockSetSetting).toHaveBeenCalledWith("list.sortOrder", "asc");
    expect(mockSetSetting).toHaveBeenCalledWith("list.previewChars", 300);
    expect(mockSetSetting).toHaveBeenCalledWith("list.recentCount", 3);
  });

  it("falls back to defaults when the settings read fails", async () => {
    mockGetSetting.mockRejectedValue(new Error("no backend"));
    const prefs = await load();
    await expect(prefs.init()).resolves.toBeUndefined();
    expect(prefs.previewChars).toBe(90);
  });
});

describe("LIST_DEFAULTS defaults", () => {
  it("starts every field at its default", async () => {
    const mod = await import("./list.svelte");
    const { LIST_DEFAULTS, listPrefs } = mod;
    const expected = { sortBy: "updatedAt", sortOrder: "desc", previewChars: 90, recentCount: 5, reopenLast: false };
    expect(LIST_DEFAULTS).toEqual(expected);
    for (const [k, v] of Object.entries(expected)) expect(listPrefs[k as keyof typeof expected]).toBe(v);
  });
});
