// The command set the palette is built from, per selection state. The stores
// are stand-ins: what matters here is which commands exist, what they say,
// and which store method each one runs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "$lib/api/types";

const stores = vi.hoisted(() => ({
  library: {
    selected: null as Note | null,
    selectedTags: [] as { id: string; name: string }[],
    isSticky: vi.fn((_id: string) => false),
    newNote: vi.fn(),
    newWhiteboard: vi.fn(),
    selectGraph: vi.fn(),
    togglePinned: vi.fn(),
    toggleArchived: vi.fn(),
    restoreSelected: vi.fn(),
    deleteSelected: vi.fn(),
    flushPendingEdits: vi.fn(),
    toggleSticky: vi.fn(),
  },
  sidebar: { collapsed: false, toggle: vi.fn() },
  theme: {
    allThemes: [
      { id: "manuscript", name: "Manuscript" },
      { id: "terminal", name: "Terminal" },
    ],
    activeId: "manuscript",
    bodyFontId: null as string | null,
    resolvedVariant: "dark" as "dark" | "light",
    setBodyFont: vi.fn(),
    setTheme: vi.fn(),
    setMode: vi.fn(),
    toggleLightDark: vi.fn(),
  },
  agents: { show: vi.fn() },
  contexting: { render: vi.fn(() => "rendered context") },
  confirmConvertToWhiteboard: vi.fn(),
  exportTheme: vi.fn(),
  importTheme: vi.fn(),
}));

vi.mock("$lib/stores/library.svelte", () => ({ library: stores.library }));
vi.mock("$lib/stores/sidebar.svelte", () => ({ sidebar: stores.sidebar }));
vi.mock("$lib/stores/theme.svelte", () => ({ theme: stores.theme }));
vi.mock("$lib/stores/agents.svelte", () => ({ agents: stores.agents }));
vi.mock("$lib/stores/contexting.svelte", () => ({ contexting: stores.contexting }));
vi.mock("$lib/whiteboard/convert", () => ({
  confirmConvertToWhiteboard: stores.confirmConvertToWhiteboard,
}));
vi.mock("$lib/themes/share", () => ({
  exportTheme: stores.exportTheme,
  importTheme: stores.importTheme,
}));

import { buildCommands, type Command } from "./commands";
import { BODY_FONTS } from "$lib/themes/fonts";
import { UPDATE_NOTE_ID } from "$lib/update/space";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Groceries",
    body: "milk",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document",
    ...overrides,
  };
}

function ids(commands: Command[]): string[] {
  return commands.map((c) => c.id);
}

function find(commands: Command[], id: string): Command {
  const cmd = commands.find((c) => c.id === id);
  if (!cmd) throw new Error(`no command ${id}`);
  return cmd;
}

const NOTE_COMMANDS = [
  "note.pin",
  "note.archive",
  "note.delete",
  "note.copyContext",
  "note.sticky",
  "note.toWhiteboard",
];

beforeEach(() => {
  vi.clearAllMocks();
  stores.library.selected = null;
  stores.library.selectedTags = [];
  stores.library.isSticky.mockImplementation(() => false);
  stores.sidebar.collapsed = false;
  stores.theme.activeId = "manuscript";
  stores.theme.bodyFontId = null;
  stores.theme.resolvedVariant = "dark";
});

describe("buildCommands with no note open", () => {
  it("offers the global commands and none of the note ones", () => {
    const commands = buildCommands();
    const got = ids(commands);
    for (const id of ["note.new", "note.newWhiteboard", "view.graph", "view.sidebar", "view.agents"]) {
      expect(got).toContain(id);
    }
    for (const id of NOTE_COMMANDS) expect(got).not.toContain(id);
    // Every id is unique, so the palette's recents and keys cannot collide.
    expect(new Set(got).size).toBe(got.length);
  });

  it("lists the font and theme folders with one leaf per choice", () => {
    const commands = buildCommands();
    expect(find(commands, "font.body").run).toBeTypeOf("function");
    const fontLeaves = commands.filter((c) => c.parent === "font.body");
    expect(fontLeaves.map((c) => c.id)).toEqual([
      "font.body.default",
      ...BODY_FONTS.map((f) => `font.body.${f.id}`),
    ]);
    const themeLeaves = commands.filter((c) => c.parent === "themes");
    expect(themeLeaves.map((c) => c.id)).toEqual([
      "theme.toggle",
      "theme.set.manuscript",
      "theme.set.terminal",
    ]);
    // The light/dark toggle is the emphasised mode switch at the top of
    // the folder, with the icon for what is showing now.
    const toggle = find(commands, "theme.toggle");
    expect(toggle.emphasis).toBe(true);
    expect(toggle.icon?.()).toBe("☾");
    stores.theme.resolvedVariant = "light";
    expect(toggle.icon?.()).toBe("☀");
  });

  it("marks the active theme and font, and applying one keeps the palette open", () => {
    stores.theme.bodyFontId = "georgia";
    const commands = buildCommands();
    expect(find(commands, "theme.set.manuscript").isActive?.()).toBe(true);
    expect(find(commands, "theme.set.terminal").isActive?.()).toBe(false);
    expect(find(commands, "font.body.georgia").isActive?.()).toBe(true);
    expect(find(commands, "font.body.default").isActive?.()).toBe(false);
    const pick = find(commands, "theme.set.terminal");
    expect(pick.keepOpenAfterRun).toBe(true);
    void pick.run();
    expect(stores.theme.setTheme).toHaveBeenCalledWith("terminal");
    void find(commands, "font.body.default").run();
    expect(stores.theme.setBodyFont).toHaveBeenCalledWith(null);
  });

  it("names the sidebar command for what it will do", () => {
    expect(find(buildCommands(), "view.sidebar").title).toBe("Hide sidebar");
    stores.sidebar.collapsed = true;
    expect(find(buildCommands(), "view.sidebar").title).toBe("Show sidebar");
  });

  it("runs the global commands against their stores", () => {
    const commands = buildCommands();
    void find(commands, "note.new").run();
    void find(commands, "note.newWhiteboard").run();
    void find(commands, "view.graph").run();
    void find(commands, "view.sidebar").run();
    void find(commands, "view.agents").run();
    void find(commands, "theme.auto").run();
    void find(commands, "theme.toggle").run();
    void find(commands, "theme.import").run();
    void find(commands, "theme.export").run();
    expect(stores.library.newNote).toHaveBeenCalledOnce();
    expect(stores.library.newWhiteboard).toHaveBeenCalledOnce();
    expect(stores.library.selectGraph).toHaveBeenCalledOnce();
    expect(stores.sidebar.toggle).toHaveBeenCalledOnce();
    expect(stores.agents.show).toHaveBeenCalledOnce();
    expect(stores.theme.setMode).toHaveBeenCalledWith("auto");
    expect(stores.theme.toggleLightDark).toHaveBeenCalledOnce();
    expect(stores.importTheme).toHaveBeenCalledOnce();
    expect(stores.exportTheme).toHaveBeenCalledOnce();
  });
});

describe("buildCommands with a document open", () => {
  it("adds every note command, prefixed with the note's title", () => {
    stores.library.selected = note();
    const commands = buildCommands();
    for (const id of NOTE_COMMANDS) {
      expect(find(commands, id).prefix).toBe("Groceries");
    }
    expect(find(commands, "note.pin").title).toBe("Pin note");
    expect(find(commands, "note.archive").title).toBe("Archive note");
    expect(find(commands, "note.delete").title).toBe("Delete note");
    expect(find(commands, "note.sticky").title).toBe("Open as sticky");
    expect(find(commands, "note.toWhiteboard").title).toBe("Turn into whiteboard…");
  });

  it("flips the pin and archive labels with the note's flags", () => {
    stores.library.selected = note({ isPinned: true, isArchived: true });
    const commands = buildCommands();
    expect(find(commands, "note.pin").title).toBe("Unpin note");
    expect(find(commands, "note.archive").title).toBe("Unarchive note");
  });

  it("calls a note with no title Untitled", () => {
    stores.library.selected = note({ title: "" });
    expect(find(buildCommands(), "note.pin").prefix).toBe("Untitled");
  });

  it("runs the note commands against the library", async () => {
    stores.library.selected = note();
    const commands = buildCommands();
    void find(commands, "note.pin").run();
    void find(commands, "note.archive").run();
    void find(commands, "note.delete").run();
    void find(commands, "note.sticky").run();
    void find(commands, "note.toWhiteboard").run();
    expect(stores.library.togglePinned).toHaveBeenCalledOnce();
    expect(stores.library.toggleArchived).toHaveBeenCalledOnce();
    expect(stores.library.deleteSelected).toHaveBeenCalledOnce();
    expect(stores.library.restoreSelected).not.toHaveBeenCalled();
    expect(stores.library.toggleSticky).toHaveBeenCalledOnce();
    expect(stores.confirmConvertToWhiteboard).toHaveBeenCalledOnce();
  });

  it("copies the note as context after flushing the pending edit", async () => {
    stores.library.selected = note();
    stores.library.selectedTags = [{ id: "t1", name: "food" }];
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await find(buildCommands(), "note.copyContext").run();
    expect(stores.library.flushPendingEdits).toHaveBeenCalledOnce();
    expect(stores.contexting.render).toHaveBeenCalledWith(
      stores.library.selected,
      stores.library.selectedTags,
    );
    expect(writeText).toHaveBeenCalledWith("rendered context");
  });
});

describe("buildCommands with other kinds of note open", () => {
  it("a note in the Trash restores instead of deleting, and cannot pop out or convert", () => {
    stores.library.selected = note({ isDeleted: true });
    const commands = buildCommands();
    const del = find(commands, "note.delete");
    expect(del.title).toBe("Restore note");
    void del.run();
    expect(stores.library.restoreSelected).toHaveBeenCalledOnce();
    expect(stores.library.deleteSelected).not.toHaveBeenCalled();
    expect(ids(commands)).not.toContain("note.sticky");
    expect(ids(commands)).not.toContain("note.toWhiteboard");
  });

  it("a sticky offers to come back, and cannot convert while it is out", () => {
    stores.library.selected = note();
    stores.library.isSticky.mockImplementation((id) => id === "n1");
    const commands = buildCommands();
    expect(find(commands, "note.sticky").title).toBe("Bring back from sticky");
    expect(ids(commands)).not.toContain("note.toWhiteboard");
  });

  it("a whiteboard can pop out but has nothing to convert", () => {
    stores.library.selected = note({ contentKind: "whiteboard" });
    const commands = buildCommands();
    expect(ids(commands)).toContain("note.sticky");
    expect(ids(commands)).not.toContain("note.toWhiteboard");
  });

  it("a synthetic note (the update Space's) is never a sticky", () => {
    stores.library.selected = note({ id: UPDATE_NOTE_ID });
    const commands = buildCommands();
    expect(ids(commands)).toContain("note.pin");
    expect(ids(commands)).not.toContain("note.sticky");
    expect(ids(commands)).toContain("note.toWhiteboard");
  });
});
