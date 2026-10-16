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

type Store = Awaited<ReturnType<typeof load>>;

// A window of the given width, with no note open unless asked.
function at(sidebar: Store, width: number, noteOpen = false) {
  const cls = width >= 1200 ? "large" : width >= 840 ? "expanded" : width >= 600 ? "medium" : "compact";
  sidebar.setViewport(cls, width, noteOpen);
}

function saved(values: Record<string, unknown>) {
  mockGetSetting.mockImplementation(async (key: string) => (key in values ? values[key] : null));
}

describe("a large window", () => {
  it("starts with the nav, the list and the editor", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("all");
    expect(sidebar.navInline).toBe(true);
    expect(sidebar.listInline).toBe(true);
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.listHidden).toBe(false);
    expect(sidebar.navTrack).toBe(220);
    expect(sidebar.listTrack).toBe(300);
  });

  it("hides and shows the nav, and saves the choice", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggle();
    expect(sidebar.state).toBe("double");
    expect(sidebar.hidden).toBe(true);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.large", "double");
    sidebar.toggle();
    expect(sidebar.state).toBe("all");
    expect(sidebar.hidden).toBe(false);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.large", "all");
  });

  it("collapses the list to the editor alone, and brings back what it hid", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggleList();
    expect(sidebar.state).toBe("detail");
    expect(sidebar.listHidden).toBe(true);
    expect(sidebar.listOverlay).toBe(false);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.large", "detail");
    sidebar.toggleList();
    expect(sidebar.state).toBe("all");
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.large", "all");
  });

  it("brings the list back without the nav when the nav was hidden first", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggle();
    sidebar.toggleList();
    sidebar.toggleList();
    expect(sidebar.state).toBe("double");
  });

  it("opens the nav as a drawer when only the editor shows", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggleList();
    mockSetSetting.mockClear();
    sidebar.toggle();
    expect(sidebar.narrowOpen).toBe(true);
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.state).toBe("detail");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("opens the list again, and saves it, when a search needs it", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggleList();
    mockSetSetting.mockClear();
    sidebar.revealList();
    expect(sidebar.listHidden).toBe(false);
    expect(mockSetSetting).toHaveBeenCalledWith("layout.large", "all");
  });

  it("saves nothing when the list is already open", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.revealList();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("keeps the list when a note opens", async () => {
    const sidebar = await load();
    at(sidebar, 1440, true);
    sidebar.noteOpened();
    expect(sidebar.listHidden).toBe(false);
    expect(sidebar.closeOverlay()).toBe(false);
  });
});

describe("an expanded window", () => {
  it("shows the list and keeps the nav in its drawer", async () => {
    const sidebar = await load();
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
    expect(sidebar.navInline).toBe(false);
    expect(sidebar.listInline).toBe(true);
    expect(sidebar.hidden).toBe(true);
    expect(sidebar.navTrack).toBe(0);
  });

  it("peeks the nav open on toggle without saving anything", async () => {
    const sidebar = await load();
    at(sidebar, 1000);
    sidebar.toggle();
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.state).toBe("double");
    expect(mockSetSetting).not.toHaveBeenCalled();
    sidebar.toggle();
    expect(sidebar.hidden).toBe(true);
  });

  it("saves its own list choice", async () => {
    const sidebar = await load();
    at(sidebar, 1000);
    sidebar.toggleList();
    expect(sidebar.state).toBe("detail");
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.expanded", "detail");
    sidebar.toggleList();
    expect(sidebar.state).toBe("double");
  });
});

describe("a medium window", () => {
  it("shows the editor alone, with the list as a drawer closed once a note is open", async () => {
    const sidebar = await load();
    at(sidebar, 700, false);
    expect(sidebar.listOverlay).toBe(true);
    expect(sidebar.listHidden).toBe(false);
    sidebar.noteOpened();
    expect(sidebar.listHidden).toBe(true);
    at(sidebar, 650, true);
    expect(sidebar.listHidden).toBe(true);
    at(sidebar, 1440);
    at(sidebar, 700, true);
    expect(sidebar.listHidden).toBe(true);
  });

  it("opens on toggle and on a search, and closes on request", async () => {
    const sidebar = await load();
    at(sidebar, 700, true);
    sidebar.toggleList();
    expect(sidebar.listOpen).toBe(true);
    expect(sidebar.closeList()).toBe(true);
    expect(sidebar.listOpen).toBe(false);
    expect(sidebar.closeList()).toBe(false);
    sidebar.revealList();
    expect(sidebar.listOpen).toBe(true);
    sidebar.toggleList();
    expect(sidebar.listOpen).toBe(false);
  });

  it("closes the nav drawer before the list drawer on Escape", async () => {
    const sidebar = await load();
    at(sidebar, 700, true);
    sidebar.toggleList();
    sidebar.toggle();
    expect(sidebar.closeOverlay()).toBe(true);
    expect(sidebar.narrowOpen).toBe(false);
    expect(sidebar.listOpen).toBe(true);
    expect(sidebar.closeOverlay()).toBe(true);
    expect(sidebar.listOpen).toBe(false);
    expect(sidebar.closeOverlay()).toBe(false);
  });

  it("never saves a drawer opening or closing", async () => {
    const sidebar = await load();
    at(sidebar, 700, false);
    sidebar.toggleList();
    sidebar.toggle();
    sidebar.revealList();
    sidebar.noteOpened();
    sidebar.closeOverlay();
    sidebar.closeOverlay();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});

describe("a compact window", () => {
  it("stacks the panes with no list overlay and leaves the list command alone", async () => {
    const sidebar = await load();
    at(sidebar, 500);
    expect(sidebar.listOverlay).toBe(false);
    expect(sidebar.listHidden).toBe(false);
    sidebar.toggleList();
    sidebar.revealList();
    expect(sidebar.listOpen).toBe(false);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("keeps the nav in its drawer", async () => {
    const sidebar = await load();
    at(sidebar, 500);
    expect(sidebar.hidden).toBe(true);
    sidebar.toggle();
    expect(sidebar.hidden).toBe(false);
  });
});

describe("one state for each width class", () => {
  it("restores each class's last explicit choice when the window crosses a breakpoint", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggleList();
    expect(sidebar.state).toBe("detail");
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
    sidebar.toggle();
    at(sidebar, 700);
    expect(sidebar.state).toBe("detail");
    at(sidebar, 500);
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
    at(sidebar, 1440);
    expect(sidebar.state).toBe("detail");
    expect(sidebar.listHidden).toBe(true);
  });

  it("closes the nav drawer when the window crosses a breakpoint", async () => {
    const sidebar = await load();
    at(sidebar, 1000);
    sidebar.toggle();
    expect(sidebar.narrowOpen).toBe(true);
    at(sidebar, 700);
    expect(sidebar.narrowOpen).toBe(true);
    at(sidebar, 1440);
    expect(sidebar.narrowOpen).toBe(false);
  });

  it("does not let a drawer choice change the saved class state", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.toggleList();
    mockSetSetting.mockClear();
    at(sidebar, 700, true);
    sidebar.toggleList();
    sidebar.revealList();
    sidebar.noteOpened();
    sidebar.closeList();
    expect(mockSetSetting).not.toHaveBeenCalled();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("detail");
  });

  it("starts the drawers closed when a note is open, whatever was open before", async () => {
    const sidebar = await load();
    at(sidebar, 700, false);
    expect(sidebar.listOpen).toBe(true);
    at(sidebar, 1440);
    expect(sidebar.listOpen).toBe(false);
    at(sidebar, 700, true);
    expect(sidebar.listOpen).toBe(false);
  });
});

describe("what is saved", () => {
  it("restores the saved states and widths", async () => {
    saved({ "layout.large": "double", "layout.expanded": "detail", "layout.navWidth": 250, "layout.listWidth": 380 });
    const sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("double");
    expect([sidebar.navWidth, sidebar.listWidth]).toEqual([250, 380]);
    at(sidebar, 1000);
    expect(sidebar.state).toBe("detail");
  });

  it("ignores saved values that are out of range or not the right kind", async () => {
    saved({ "layout.large": "yes", "layout.expanded": 3, "layout.navWidth": 20, "layout.listWidth": "wide" });
    const sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("all");
    expect([sidebar.navWidth, sidebar.listWidth]).toEqual([220, 300]);
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
  });

  it("never lets the expanded class keep the nav inline", async () => {
    saved({ "layout.expanded": "all" });
    const sidebar = await load();
    await sidebar.init();
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
  });

  it("moves the old note list flag into the large and expanded states", async () => {
    saved({ "notes.collapsed": true });
    const sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("detail");
    at(sidebar, 1000);
    expect(sidebar.state).toBe("detail");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("moves the old sidebar flag and width over too", async () => {
    saved({ "sidebar.collapsed": true, "sidebar.width": 400, "notes.collapsed": false });
    const sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("double");
    expect(sidebar.navWidth).toBe(300);
    at(sidebar, 1000);
    expect(sidebar.state).toBe("double");
  });

  it("ignores an old flag that is not a flag, and prefers the new keys", async () => {
    saved({ "notes.collapsed": "yes" });
    let sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("all");
    vi.resetModules();
    saved({ "notes.collapsed": true, "layout.large": "all" });
    sidebar = await load();
    await sidebar.init();
    at(sidebar, 1440);
    expect(sidebar.state).toBe("all");
  });

  it("never saves an overlay being open", async () => {
    const sidebar = await load();
    at(sidebar, 700);
    sidebar.toggleList();
    sidebar.toggle();
    for (const [, value] of mockSetSetting.mock.calls) expect(typeof value).not.toBe("boolean");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});

describe("resizing the panes", () => {
  it("follows a drag inside the range and saves the width on release", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.resizeNav(260);
    expect(sidebar.navWidth).toBe(260);
    sidebar.resizeNav(900);
    expect(sidebar.navWidth).toBe(300);
    sidebar.resizeNav(80);
    expect(sidebar.navWidth).toBe(300);
    sidebar.resizeNav(100);
    expect(sidebar.navWidth).toBe(180);
    sidebar.commitDrag("nav");
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.navWidth", 180);
    sidebar.resizeList(500);
    expect(sidebar.listWidth).toBe(420);
    sidebar.commitDrag("list");
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.listWidth", 420);
  });

  it("snaps the nav collapsed below half its minimum, keeping the width it had", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.resizeNav(200);
    sidebar.resizeNav(80);
    expect(sidebar.snapping).toBe("nav");
    expect(sidebar.navTrack).toBe(0);
    expect(sidebar.state).toBe("all");
    sidebar.commitDrag("nav");
    expect(sidebar.snapping).toBeNull();
    expect(sidebar.state).toBe("double");
    expect(sidebar.navWidth).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith("layout.large", "double");
  });

  it("snaps the list collapsed, and drags back out of the snap", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.resizeList(100);
    expect(sidebar.listTrack).toBe(0);
    sidebar.resizeList(260);
    expect(sidebar.snapping).toBeNull();
    expect(sidebar.listTrack).toBe(260);
    sidebar.resizeList(100);
    sidebar.commitDrag("list");
    expect(sidebar.state).toBe("detail");
    expect(sidebar.listWidth).toBe(260);
    expect(mockSetSetting).toHaveBeenCalledWith("layout.large", "detail");
  });

  it("resets a pane to its default on a double click", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.resizeNav(280);
    sidebar.resizeList(400);
    sidebar.resetWidth("nav");
    sidebar.resetWidth("list");
    expect([sidebar.navWidth, sidebar.listWidth]).toEqual([220, 300]);
    expect(mockSetSetting).toHaveBeenCalledWith("layout.navWidth", 220);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.listWidth", 300);
  });

  it("steps 16px a key press and saves it", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    sidebar.stepPane("nav", 1);
    expect(sidebar.navWidth).toBe(236);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.navWidth", 236);
    sidebar.stepPane("list", -1);
    expect(sidebar.listWidth).toBe(284);
    expect(mockSetSetting).toHaveBeenLastCalledWith("layout.listWidth", 284);
  });

  it("never lets the panes take the editor below 420", async () => {
    const sidebar = await load();
    sidebar.setViewport("large", 1000, true);
    sidebar.resizeList(420);
    expect(sidebar.listWidth).toBe(360);
    sidebar.resizeNav(300);
    expect(sidebar.navWidth).toBe(220);
    sidebar.stepPane("list", 1);
    expect(sidebar.listWidth).toBe(360);
    sidebar.resizeList(320);
    expect(sidebar.listWidth).toBe(320);
    sidebar.resizeNav(300);
    expect(sidebar.navWidth).toBe(260);
  });
});

describe("a window too narrow for the panes", () => {
  it("lets the nav yield to its drawer first, and the list to an overlay next", async () => {
    const sidebar = await load();
    at(sidebar, 1440);
    expect(sidebar.navInline).toBe(true);
    sidebar.setViewport("large", 939, true);
    expect(sidebar.navInline).toBe(false);
    expect(sidebar.listInline).toBe(true);
    expect(sidebar.hidden).toBe(true);
    sidebar.setViewport("large", 719, true);
    expect(sidebar.listInline).toBe(false);
    expect(sidebar.listOverlay).toBe(true);
    expect(sidebar.listHidden).toBe(true);
    expect(sidebar.state).toBe("all");
    sidebar.toggleList();
    expect(sidebar.listOpen).toBe(true);
    expect(mockSetSetting).not.toHaveBeenCalled();
    sidebar.setViewport("large", 1440, true);
    expect(sidebar.navInline).toBe(true);
    expect(sidebar.listInline).toBe(true);
    expect(sidebar.listOpen).toBe(false);
  });

  it("opens the nav drawer, not the saved state, when the nav has yielded", async () => {
    const sidebar = await load();
    sidebar.setViewport("large", 900, true);
    sidebar.toggle();
    expect(sidebar.narrowOpen).toBe(true);
    expect(sidebar.state).toBe("all");
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});
