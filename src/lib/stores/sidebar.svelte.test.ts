import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

const mockSetSetting = vi.mocked(setSetting);
const mockGetSetting = vi.mocked(getSetting);

async function load() {
  const mod = await import("./sidebar.svelte");
  return mod.sidebar;
}

beforeEach(() => {
  vi.resetModules();
  mockSetSetting.mockClear();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(null);
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

describe("the note list in a wide window", () => {
  it("starts open and flips on toggle", async () => {
    const sidebar = await load();
    expect(sidebar.listHidden).toBe(false);
    sidebar.toggleList();
    expect(sidebar.listCollapsed).toBe(true);
    expect(sidebar.listHidden).toBe(true);
    sidebar.toggleList();
    expect(sidebar.listHidden).toBe(false);
  });

  it("saves the collapsed choice", async () => {
    const sidebar = await load();
    sidebar.toggleList();
    expect(mockSetSetting).toHaveBeenLastCalledWith("notes.collapsed", true);
    sidebar.toggleList();
    expect(mockSetSetting).toHaveBeenLastCalledWith("notes.collapsed", false);
  });

  it("restores the saved choice", async () => {
    mockGetSetting.mockImplementation(async (key: string) => (key === "notes.collapsed" ? true : null));
    const sidebar = await load();
    await sidebar.init();
    expect(sidebar.listCollapsed).toBe(true);
    expect(sidebar.listHidden).toBe(true);
  });

  it("ignores a saved value that is not a flag", async () => {
    mockGetSetting.mockImplementation(async (key: string) => (key === "notes.collapsed" ? "yes" : null));
    const sidebar = await load();
    await sidebar.init();
    expect(sidebar.listCollapsed).toBe(false);
  });

  it("opens again, and saves it, when a search needs the list", async () => {
    const sidebar = await load();
    sidebar.toggleList();
    mockSetSetting.mockClear();
    sidebar.revealList();
    expect(sidebar.listHidden).toBe(false);
    expect(mockSetSetting).toHaveBeenCalledWith("notes.collapsed", false);
  });

  it("saves nothing when the list is already open", async () => {
    const sidebar = await load();
    sidebar.revealList();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("keeps the list when a note opens", async () => {
    const sidebar = await load();
    sidebar.noteOpened();
    expect(sidebar.listHidden).toBe(false);
    expect(sidebar.closeList()).toBe(false);
  });
});

describe("the note list as a drawer", () => {
  it("starts open with no note and closed once a note is open", async () => {
    const sidebar = await load();
    sidebar.setListDrawer(true, false);
    expect(sidebar.listHidden).toBe(false);
    sidebar.noteOpened();
    expect(sidebar.listHidden).toBe(true);
    sidebar.setListDrawer(false, true);
    sidebar.setListDrawer(true, true);
    expect(sidebar.listHidden).toBe(true);
  });

  it("opens on toggle and on a search, and closes on request", async () => {
    const sidebar = await load();
    sidebar.setListDrawer(true, true);
    sidebar.toggleList();
    expect(sidebar.listOpen).toBe(true);
    expect(sidebar.closeList()).toBe(true);
    expect(sidebar.listOpen).toBe(false);
    sidebar.revealList();
    expect(sidebar.listOpen).toBe(true);
    sidebar.toggleList();
    expect(sidebar.listOpen).toBe(false);
  });

  it("never overwrites the saved wide-window choice", async () => {
    const sidebar = await load();
    sidebar.toggleList();
    expect(sidebar.listCollapsed).toBe(true);
    mockSetSetting.mockClear();
    sidebar.setListDrawer(true, true);
    sidebar.toggleList();
    sidebar.revealList();
    sidebar.noteOpened();
    sidebar.closeList();
    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(sidebar.listCollapsed).toBe(true);
    sidebar.setListDrawer(false, true);
    expect(sidebar.listHidden).toBe(true);
  });

  it("shows a saved open choice again after the window widens", async () => {
    const sidebar = await load();
    sidebar.setListDrawer(true, true);
    expect(sidebar.listHidden).toBe(true);
    sidebar.setListDrawer(false, true);
    expect(sidebar.listHidden).toBe(false);
  });
});
