// `imagePrefs` is a module-level singleton whose `init()` only reads settings
// once (guarded by a private #loaded flag), so — like `library` in
// library.svelte.test.ts — each test loads a fresh copy of the module via
// vi.resetModules() + dynamic import rather than reusing one instance across
// tests. Unlike the settings-page component tests, this exercises the
// init()-reads-a-persisted-value path directly, without rendering Svelte.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./images.svelte");
  return mod.imagePrefs;
}

beforeEach(() => {
  vi.resetModules();
  mockGetSetting.mockReset().mockResolvedValue(undefined);
  mockSetSetting.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imagePrefs", () => {
  it("defaults to copy storage and a 420px preview height before init", async () => {
    const prefs = await load();
    expect(prefs.storage).toBe("copy");
    expect(prefs.maxPreviewHeight).toBe(420);
  });

  it("reads a persisted storage mode and height on init", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "images.storage") return "link";
      if (key === "images.maxPreviewHeight") return 600;
      return undefined;
    });
    const prefs = await load();
    await prefs.init();
    expect(prefs.storage).toBe("link");
    expect(prefs.maxPreviewHeight).toBe(600);
  });

  it("ignores a stored value that isn't copy or link", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "images.storage" ? "invalid" : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.storage).toBe("copy");
  });

  it("clamps a persisted height below the minimum on init", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "images.maxPreviewHeight" ? 10 : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.maxPreviewHeight).toBe(120);
  });

  it("clamps a persisted height above the maximum on init", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "images.maxPreviewHeight" ? 5000 : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.maxPreviewHeight).toBe(900);
  });

  it("only fetches settings on the first init call", async () => {
    const prefs = await load();
    await prefs.init();
    await prefs.init();
    expect(mockGetSetting).toHaveBeenCalledTimes(2); // storage + height, once each
  });

  it("falls back to defaults silently when the settings read fails", async () => {
    mockGetSetting.mockRejectedValue(new Error("no backend"));
    const prefs = await load();
    await expect(prefs.init()).resolves.toBeUndefined();
    expect(prefs.storage).toBe("copy");
    expect(prefs.maxPreviewHeight).toBe(420);
  });

  it("setStorage updates state and persists immediately", async () => {
    const prefs = await load();
    prefs.setStorage("link");
    expect(prefs.storage).toBe("link");
    expect(mockSetSetting).toHaveBeenCalledWith("images.storage", "link");
  });

  it("setMaxPreviewHeight clamps and persists the clamped value", async () => {
    const prefs = await load();
    prefs.setMaxPreviewHeight(50);
    expect(prefs.maxPreviewHeight).toBe(120);
    expect(mockSetSetting).toHaveBeenCalledWith("images.maxPreviewHeight", 120);

    prefs.setMaxPreviewHeight(1200);
    expect(prefs.maxPreviewHeight).toBe(900);
    expect(mockSetSetting).toHaveBeenCalledWith("images.maxPreviewHeight", 900);
  });
});
