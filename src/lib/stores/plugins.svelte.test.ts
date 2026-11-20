import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockPost = vi.fn();
const mockCancel = vi.fn();

vi.mock("$lib/api/client", () => ({
  getSetting: (key: string) => mockGetSetting(key),
  setSetting: (key: string, value: unknown) => mockSetSetting(key, value),
  pluginHttpPost: (id: number, url: string, body: string) => mockPost(id, url, body),
  pluginHttpCancel: (id: number) => mockCancel(id),
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
  mockPost.mockReset();
  mockCancel.mockReset().mockResolvedValue(undefined);
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

  it("keeps free text and file prefs, and shows a pref only when its condition holds", async () => {
    const { prefs } = await load();
    const { plugins } = await import("$lib/plugin");
    const assist = plugins.find((p) => p.id === "assist")!;
    const spec = (key: string) => assist.prefs!.find((s) => s.key === key)!;
    expect(prefs.shown(assist, spec("address"))).toBe(false);
    expect(prefs.shown(assist, spec("ignore"))).toBe(false);
    prefs.setValue(assist, spec("complete"), "model");
    prefs.setValue(assist, spec("complete"), "nonsense");
    prefs.setValue(assist, spec("address"), "http://127.0.0.1:8080");
    prefs.setValue(assist, spec("dictionary"), "/dict/en.dic");
    expect(prefs.value(assist, spec("complete"))).toBe("model");
    expect(prefs.shown(assist, spec("address"))).toBe(true);
    expect(prefs.shown(assist, spec("ignore"))).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith("plugin.assist.address", "http://127.0.0.1:8080");
    expect(prefs.config.prefs.assist).toMatchObject({ complete: "model", dictionary: "/dict/en.dic" });
  });

  it("keeps the current values on screen while a reload is still reading", async () => {
    const stored: Record<string, unknown> = { "plugin.calc.enabled": false };
    mockGetSetting.mockImplementation(async (key: string) => stored[key]);
    const { prefs, calc } = await load();
    await prefs.init();
    stored["plugin.calc.enabled"] = true;
    const reading = prefs.reload();
    expect(prefs.on(calc)).toBe(false);
    await reading;
    expect(prefs.on(calc)).toBe(true);
  });

  it("tells the shell to drop a request the caller aborted", async () => {
    const { prefs } = await load();
    let answer!: (text: string) => void;
    mockPost.mockReturnValue(new Promise<string>((resolve) => (answer = resolve)));
    const stop = new AbortController();
    const reply = prefs.host.post("http://127.0.0.1:8080/v1/completions", "{}", stop.signal);
    stop.abort();
    expect(mockCancel).toHaveBeenCalledWith(mockPost.mock.calls[0][0]);
    answer("{}");
    expect(await reply).toBe("{}");
  });

  it("hands plugins a new config when one asks for a refresh", async () => {
    const { prefs } = await load();
    const before = prefs.config;
    expect(prefs.config).toBe(before);
    before.context?.host.refresh();
    expect(prefs.config).not.toBe(before);
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
