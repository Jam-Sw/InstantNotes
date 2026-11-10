import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock("$lib/api/client", () => ({
  getSetting: (key: string) => mockGetSetting(key),
  setSetting: (key: string, value: unknown) => mockSetSetting(key, value),
}));

async function load() {
  vi.resetModules();
  const { pluginPrefs } = await import("./plugins.svelte");
  const { plugins } = await import("$lib/plugin");
  const calc = plugins.find((p) => p.id === "calc")!;
  return { prefs: pluginPrefs, calc, precision: calc.prefs![0] };
}

beforeEach(() => {
  mockGetSetting.mockReset().mockResolvedValue(undefined);
  mockSetSetting.mockReset().mockResolvedValue(undefined);
});

describe("pluginPrefs", () => {
  it("starts every plugin on with its default prefs", async () => {
    const { prefs, calc, precision } = await load();
    await prefs.init();
    expect(prefs.on(calc)).toBe(true);
    expect(prefs.value(calc, precision)).toBe("short");
    expect(prefs.config.plugins).toContain(calc);
    expect(prefs.config.prefs.calc).toEqual({ precision: "short" });
  });

  it("reads stored values and ignores invalid ones", async () => {
    const stored: Record<string, unknown> = { "plugin.calc.enabled": false, "plugin.calc.precision": "huge" };
    mockGetSetting.mockImplementation(async (key: string) => stored[key]);
    const { prefs, calc, precision } = await load();
    await prefs.init();
    expect(prefs.on(calc)).toBe(false);
    expect(prefs.value(calc, precision)).toBe("short");
    expect(prefs.config.plugins).not.toContain(calc);
  });

  it("saves the switch and each pref under the plugin's keys", async () => {
    const { prefs, calc, precision } = await load();
    prefs.setOn(calc, false);
    prefs.setValue(calc, precision, "long");
    expect(mockSetSetting).toHaveBeenCalledWith("plugin.calc.enabled", false);
    expect(mockSetSetting).toHaveBeenCalledWith("plugin.calc.precision", "long");
    expect(prefs.config.plugins).not.toContain(calc);
  });
});
