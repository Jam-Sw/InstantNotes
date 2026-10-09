import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./sidebar.svelte");
  return mod.sidebar;
}

beforeEach(() => {
  vi.resetModules();
  mockSetSetting.mockClear();
});

describe("sidebar in a wide window", () => {
  it("toggles the saved collapsed flag", async () => {
    const sidebar = await load();
    sidebar.toggle();
    expect(sidebar.collapsed).toBe(true);
    expect(sidebar.hidden).toBe(true);
    expect(mockSetSetting).toHaveBeenCalledWith("sidebar.collapsed", true);
  });
});

describe("sidebar in a narrow window", () => {
  it("peeks open on toggle without saving the collapsed flag", async () => {
    const sidebar = await load();
    sidebar.setNarrow(true);
    expect(sidebar.hidden).toBe(true);
    sidebar.toggle();
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.collapsed).toBe(false);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("closes the peek again when the window stays narrow", async () => {
    const sidebar = await load();
    sidebar.setNarrow(true);
    sidebar.toggle();
    sidebar.setNarrow(false);
    sidebar.setNarrow(true);
    expect(sidebar.hidden).toBe(true);
  });

  it("restores the saved state when the window widens", async () => {
    const sidebar = await load();
    sidebar.toggle();
    sidebar.setNarrow(true);
    expect(sidebar.hidden).toBe(true);
    sidebar.setNarrow(false);
    expect(sidebar.hidden).toBe(true);
    sidebar.toggle();
    expect(sidebar.hidden).toBe(false);
    expect(mockSetSetting).toHaveBeenLastCalledWith("sidebar.collapsed", false);
  });
});
