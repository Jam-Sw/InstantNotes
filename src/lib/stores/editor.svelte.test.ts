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

  it("applies a stored width as --measure and ignores an unknown one", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.width" ? "full" : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.width).toBe("full");
    expect(document.documentElement.style.getPropertyValue("--measure")).toBe("100vw");

    vi.resetModules();
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.width" ? "huge" : undefined,
    );
    const next = await load();
    await next.init();
    expect(next.width).toBe("readable");
  });

  it("saves and applies a width choice", async () => {
    const prefs = await load();
    prefs.setWidth("wide");
    expect(mockSetSetting).toHaveBeenCalledWith("editor.width", "wide");
    expect(document.documentElement.style.getPropertyValue("--measure")).toBe("110ch");
    prefs.setWidth("readable");
    expect(document.documentElement.style.getPropertyValue("--measure")).toBe("70ch");
  });

  it("only fetches settings on the first init call", async () => {
    const prefs = await load();
    await prefs.init();
    await prefs.init();
    expect(mockGetSetting).toHaveBeenCalledTimes(10);
  });

  it("shows the toolbar by default, in the rendered view", async () => {
    const prefs = await load();
    expect(prefs.toolbarOpen).toBe(true);
    expect(prefs.sourceMode).toBe(false);
    await prefs.init();
    expect(prefs.toolbarOpen).toBe(true);
    expect(prefs.sourceMode).toBe(false);
  });

  it("respects a stored false for the toolbar and a stored true for the source view", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.toolbarOpen" ? false : key === "editor.sourceMode" ? true : undefined,
    );
    const prefs = await load();
    await prefs.init();
    expect(prefs.toolbarOpen).toBe(false);
    expect(prefs.sourceMode).toBe(true);
  });

  it("toggles the toolbar and the source view under their own keys", async () => {
    const prefs = await load();
    prefs.toggleToolbar();
    expect(mockSetSetting).toHaveBeenCalledWith("editor.toolbarOpen", false);
    prefs.toggleSourceMode();
    expect(prefs.sourceMode).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.sourceMode", true);
    expect(prefs.toolbarOpen).toBe(false);
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
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.showExactTime" ? false : undefined,
    );
    const prefs = await load();
    const initDone = prefs.init();
    prefs.setShowExactTime(true);
    await initDone;
    expect(prefs.showExactTime).toBe(true);
  });

  it("defaults the editor settings to today's behaviour", async () => {
    const prefs = await load();
    await prefs.init();
    expect(prefs.spellcheck).toBe(false);
    expect(prefs.wrap).toBe(true);
    expect(prefs.calcPrecision).toBe("short");
    expect(prefs.autosaveMs).toBe(400);
    expect(prefs.indentWidth).toBe(2);
  });

  it("reads valid stored spellcheck, wrap, precision, autosave and indent values", async () => {
    const stored: Record<string, unknown> = {
      "editor.spellcheck": true,
      "editor.wrap": false,
      "editor.calcPrecision": "long",
      "editor.autosaveMs": 1000,
      "editor.indentWidth": 4,
    };
    mockGetSetting.mockImplementation(async (key: string) => stored[key]);
    const prefs = await load();
    await prefs.init();
    expect(prefs.spellcheck).toBe(true);
    expect(prefs.wrap).toBe(false);
    expect(prefs.calcPrecision).toBe("long");
    expect(prefs.autosaveMs).toBe(1000);
    expect(prefs.indentWidth).toBe(4);
  });

  it("ignores invalid stored values for the new settings", async () => {
    const stored: Record<string, unknown> = {
      "editor.spellcheck": "yes",
      "editor.wrap": 0,
      "editor.calcPrecision": "huge",
      "editor.autosaveMs": 333,
      "editor.indentWidth": 8,
    };
    mockGetSetting.mockImplementation(async (key: string) => stored[key]);
    const prefs = await load();
    await prefs.init();
    expect(prefs.spellcheck).toBe(false);
    expect(prefs.wrap).toBe(true);
    expect(prefs.calcPrecision).toBe("short");
    expect(prefs.autosaveMs).toBe(400);
    expect(prefs.indentWidth).toBe(2);
  });

  it("saves each new setting under its own key", async () => {
    const prefs = await load();
    prefs.setSpellcheck(true);
    prefs.setWrap(false);
    prefs.setCalcPrecision("long");
    prefs.setAutosaveMs(150);
    prefs.setIndentWidth(4);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.spellcheck", true);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.wrap", false);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.calcPrecision", "long");
    expect(mockSetSetting).toHaveBeenCalledWith("editor.autosaveMs", 150);
    expect(mockSetSetting).toHaveBeenCalledWith("editor.indentWidth", 4);
  });

  it("keeps a value set before init finishes", async () => {
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "editor.wrap" ? true : undefined,
    );
    const prefs = await load();
    prefs.setWrap(false);
    await prefs.init();
    expect(prefs.wrap).toBe(false);
  });
});

describe("EDITOR_DEFAULTS defaults", () => {
  it("starts every field at its default", async () => {
    const mod = await import("./editor.svelte");
    const { EDITOR_DEFAULTS, editorPrefs } = mod;
    const expected = { zoom: 1, toolbarOpen: true, sourceMode: false, showExactTime: false, width: "readable", spellcheck: false, wrap: true, calcPrecision: "short", autosaveMs: 400, indentWidth: 2 };
    expect(EDITOR_DEFAULTS).toEqual(expected);
    for (const [k, v] of Object.entries(expected)) expect(editorPrefs[k as keyof typeof expected]).toBe(v);
  });
});
