// `editorPrefs` is a module-level singleton whose `init()` only reads
// settings once (guarded by a private #loaded flag), so — like `imagePrefs`
// in images.svelte.test.ts — each test loads a fresh copy of the module via
// vi.resetModules() + dynamic import.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./editor.svelte");
  return mod.editorPrefs;
}

beforeEach(() => {
  vi.resetModules();
  mockGetSetting.mockReset().mockResolvedValue(undefined);
  mockSetSetting.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("editorPrefs", () => {
  it("defaults to showExactTime off before init", async () => {
    const prefs = await load();
    expect(prefs.showExactTime).toBe(false);
  });

  it("reads a persisted showExactTime on init", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.showExactTime" ? true : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.showExactTime).toBe(true);
  });

  it("only fetches settings on the first init call", async () => {
    const prefs = await load();
    await prefs.init();
    await prefs.init();
    expect(mockGetSetting).toHaveBeenCalledTimes(3); // zoom + toolbarOpen + showExactTime, once each
  });

  it("falls back to defaults silently when the settings read fails", async () => {
    mockGetSetting.mockRejectedValue(new Error("no backend"));
    const prefs = await load();
    await expect(prefs.init()).resolves.toBeUndefined();
    expect(prefs.showExactTime).toBe(false);
  });

  it("setShowExactTime updates state and persists immediately", async () => {
    const prefs = await load();
    prefs.setShowExactTime(true);
    expect(prefs.showExactTime).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.showExactTime", true);

    prefs.setShowExactTime(false);
    expect(prefs.showExactTime).toBe(false);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.showExactTime", false);
  });

  it("re-reading after setShowExactTime does not clobber the value with a stale init", async () => {
    // init() is one-shot; calling set before init ever resolves must not let
    // a slow settings read overwrite the user's explicit change afterward.
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.showExactTime" ? false : undefined,
    );
    const prefs = await load();
    const initDone = prefs.init();
    prefs.setShowExactTime(true);
    await initDone;
    expect(prefs.showExactTime).toBe(true);
  });
});
