import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting, setWindowTheme, setWindowVibrancy } from "$lib/api/client";
import { manuscript } from "$lib/themes/builtin/manuscript";
import { DEFAULT_THEME_ID } from "$lib/themes/builtin";
import type { Theme } from "$lib/themes/types";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(async () => {}),
  setWindowVibrancy: vi.fn(async () => {}),
  setWindowTheme: vi.fn(async () => {}),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);
const mockSetWindowTheme = vi.mocked(setWindowTheme);
const mockSetWindowVibrancy = vi.mocked(setWindowVibrancy);

const custom: Theme = { ...manuscript, id: "custom-1", name: "Custom One" };

let systemDark = true;
let onSystemChange: ((e: { matches: boolean }) => void) | null = null;

function settings(values: Record<string, unknown>) {
  mockGetSetting.mockImplementation(async (key: string) => values[key] ?? null);
}

async function load() {
  const mod = await import("./theme.svelte");
  return mod.theme;
}

beforeEach(() => {
  vi.resetModules();
  mockGetSetting.mockReset();
  mockSetSetting.mockClear();
  mockSetWindowTheme.mockClear();
  mockSetWindowVibrancy.mockClear();
  systemDark = true;
  onSystemChange = null;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: systemDark,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        onSystemChange = fn;
      },
    })),
  });
  settings({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loading from settings", () => {
  it("takes every valid value back", async () => {
    settings({
      "theme.active": "terminal",
      "theme.mode": "dark",
      "theme.custom": [custom],
      "theme.font.body": "georgia",
    });
    const theme = await load();
    await theme.init();
    expect(theme.activeId).toBe("terminal");
    expect(theme.mode).toBe("dark");
    expect(theme.customThemes.map((t) => t.id)).toEqual(["custom-1"]);
    expect(theme.bodyFontId).toBe("georgia");
    expect(theme.allThemes.some((t) => t.id === "custom-1")).toBe(true);
  });

  it("an active id that names a custom theme is honoured, since customs load first", async () => {
    settings({ "theme.active": "custom-1", "theme.custom": [custom] });
    const theme = await load();
    await theme.init();
    expect(theme.activeId).toBe("custom-1");
    expect(theme.activeTheme.name).toBe("Custom One");
  });

  it("falls back to the defaults for every invalid value", async () => {
    settings({
      "theme.active": "no-such-theme",
      "theme.mode": "purple",
      "theme.custom": [{ id: "junk" }, "not a theme", { ...custom, version: 2 }],
      "theme.font.body": "comic-sans",
    });
    const theme = await load();
    await theme.init();
    expect(theme.activeId).toBe(DEFAULT_THEME_ID);
    expect(theme.mode).toBe("auto");
    expect(theme.customThemes).toEqual([]);
    expect(theme.bodyFontId).toBeNull();
  });

  it("keeps the valid custom themes when one in the list is not", async () => {
    settings({ "theme.custom": [{ id: "junk" }, custom] });
    const theme = await load();
    await theme.init();
    expect(theme.customThemes.map((t) => t.id)).toEqual(["custom-1"]);
  });

  it("a settings read that fails leaves the defaults and still applies", async () => {
    mockGetSetting.mockRejectedValue(new Error("no store"));
    const theme = await load();
    await expect(theme.init()).resolves.toBeUndefined();
    expect(theme.activeId).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
  });

  it("writes the theme's variables and variant to the document and the window", async () => {
    settings({ "theme.active": "terminal", "theme.mode": "light" });
    const theme = await load();
    await theme.init();
    expect(document.documentElement.dataset.theme).toBe("terminal");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).not.toBe("");
    expect(mockSetWindowTheme).toHaveBeenCalledWith("light");
    expect(mockSetWindowVibrancy).toHaveBeenCalled();
  });
});

describe("resolvedVariant", () => {
  it("auto follows the system appearance, and reacts when it changes", async () => {
    const theme = await load();
    await theme.init();
    expect(theme.mode).toBe("auto");
    expect(theme.resolvedVariant).toBe("dark");
    onSystemChange?.({ matches: false });
    expect(theme.resolvedVariant).toBe("light");
    expect(document.documentElement.dataset.variant).toBe("light");
  });

  it("auto starts light when the system is light", async () => {
    systemDark = false;
    const theme = await load();
    await theme.init();
    expect(theme.resolvedVariant).toBe("light");
  });

  it("an explicit mode wins over the system, and is persisted", async () => {
    systemDark = false;
    const theme = await load();
    await theme.init();
    theme.setMode("dark");
    expect(theme.resolvedVariant).toBe("dark");
    expect(mockSetSetting).toHaveBeenCalledWith("theme.mode", "dark");
    theme.setMode("light");
    expect(theme.resolvedVariant).toBe("light");
    onSystemChange?.({ matches: true });
    expect(theme.resolvedVariant).toBe("light");
  });

  it("toggleLightDark pins the opposite of what is showing", async () => {
    const theme = await load();
    await theme.init();
    expect(theme.resolvedVariant).toBe("dark");
    theme.toggleLightDark();
    expect(theme.mode).toBe("light");
    expect(theme.resolvedVariant).toBe("light");
    theme.toggleLightDark();
    expect(theme.mode).toBe("dark");
  });
});

describe("custom themes", () => {
  it("adding one lists it, makes it active, and persists both", async () => {
    const theme = await load();
    await theme.init();
    theme.addCustomTheme(custom);
    expect(theme.customThemes).toEqual([custom]);
    expect(theme.activeId).toBe("custom-1");
    expect(mockSetSetting).toHaveBeenCalledWith("theme.custom", [custom]);
    expect(mockSetSetting).toHaveBeenCalledWith("theme.active", "custom-1");
  });

  it("adding a theme with an existing id replaces it rather than stacking", async () => {
    const theme = await load();
    await theme.init();
    theme.addCustomTheme(custom);
    theme.addCustomTheme({ ...custom, name: "Custom One, revised" });
    expect(theme.customThemes.map((t) => t.name)).toEqual(["Custom One, revised"]);
  });

  it("removing the active custom theme falls back to the default", async () => {
    const theme = await load();
    await theme.init();
    theme.addCustomTheme(custom);
    mockSetSetting.mockClear();
    theme.removeCustomTheme("custom-1");
    expect(theme.customThemes).toEqual([]);
    expect(theme.activeId).toBe(DEFAULT_THEME_ID);
    expect(mockSetSetting).toHaveBeenCalledWith("theme.custom", []);
    expect(mockSetSetting).toHaveBeenCalledWith("theme.active", DEFAULT_THEME_ID);
  });

  it("removing a custom theme that is not active leaves the active one alone", async () => {
    const theme = await load();
    await theme.init();
    theme.addCustomTheme(custom);
    theme.setTheme("terminal");
    theme.removeCustomTheme("custom-1");
    expect(theme.activeId).toBe("terminal");
  });

  it("setTheme ignores an id it does not know", async () => {
    const theme = await load();
    await theme.init();
    mockSetSetting.mockClear();
    theme.setTheme("no-such-theme");
    expect(theme.activeId).toBe(DEFAULT_THEME_ID);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("serialize gives the theme as JSON, the active one by default", async () => {
    const theme = await load();
    await theme.init();
    theme.addCustomTheme(custom);
    expect(JSON.parse(theme.serialize())).toEqual(custom);
    expect(JSON.parse(theme.serialize("terminal")).id).toBe("terminal");
  });
});
