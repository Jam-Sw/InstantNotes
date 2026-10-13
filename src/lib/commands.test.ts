import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "$lib/api/types";

const stores = vi.hoisted(() => ({
  library: {
    selected: null as Note | null,
    selectedTags: [] as { id: string; name: string }[],
    isSticky: vi.fn((_id: string) => false),
    newNote: vi.fn(),
    newWhiteboard: vi.fn(),
    newSheet: vi.fn(),
    selectGraph: vi.fn(),
    togglePinned: vi.fn(),
    toggleArchived: vi.fn(),
    restoreSelected: vi.fn(),
    deleteSelected: vi.fn(),
    flushPendingEdits: vi.fn(),
    toggleSticky: vi.fn(),
  },
  sidebar: { collapsed: false, hidden: false, toggle: vi.fn() },
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
  shell: {
    settingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    togglePalette: vi.fn(),
  },
  editorPrefs: {
    toolbarOpen: true,
    sourceMode: false,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    toggleToolbar: vi.fn(),
    toggleSourceMode: vi.fn(),
  },
  updater: {
    pendingUpdate: false,
    version: null as string | null,
    checkNow: vi.fn(async () => {}),
    show: vi.fn(),
  },
  licenseSpace: { locked: false },
  exportSelectedNote: vi.fn(async () => {}),
  client: { backupNow: vi.fn(async () => ({})), openDataFolder: vi.fn(), openUrl: vi.fn(), requestQuit: vi.fn() },
  vaultExport: {
    exportArchiveDownload: vi.fn(async () => ({ ok: true as const })),
    exportVaultToFolder: vi.fn(async () => ({ ok: true as const })),
  },
  toasts: { show: vi.fn() },
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
vi.mock("$lib/stores/shell.svelte", () => ({ shell: stores.shell }));
vi.mock("$lib/stores/editor.svelte", () => ({ editorPrefs: stores.editorPrefs }));
vi.mock("$lib/stores/updater.svelte", () => ({ updater: stores.updater }));
vi.mock("$lib/stores/license-space.svelte", () => ({ licenseSpace: stores.licenseSpace }));
vi.mock("$lib/note-export", () => ({ exportSelectedNote: stores.exportSelectedNote }));
vi.mock("$lib/api/client", () => stores.client);
vi.mock("$lib/vault-export", () => stores.vaultExport);
vi.mock("$lib/stores/toasts.svelte", () => ({ toasts: stores.toasts }));

import { readFileSync } from "node:fs";
import { buildCommands, runCommand, type Command } from "./commands";
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
  stores.sidebar.hidden = false;
  stores.theme.activeId = "manuscript";
  stores.theme.bodyFontId = null;
  stores.theme.resolvedVariant = "dark";
  stores.updater.pendingUpdate = false;
  stores.updater.version = null;
  stores.licenseSpace.locked = false;
});

describe("buildCommands with no note open", () => {
  it("offers the global commands and none of the note ones", () => {
    const commands = buildCommands();
    const got = ids(commands);
    for (const id of ["note.new", "note.newWhiteboard", "note.newSheet", "view.graph", "view.sidebar", "view.agents"]) {
      expect(got).toContain(id);
    }
    for (const id of NOTE_COMMANDS) expect(got).not.toContain(id);
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
    stores.sidebar.hidden = true;
    expect(find(buildCommands(), "view.sidebar").title).toBe("Show sidebar");
  });

  it("runs the global commands against their stores", () => {
    const commands = buildCommands();
    void find(commands, "note.new").run();
    void find(commands, "note.newWhiteboard").run();
    void find(commands, "note.newSheet").run();
    void find(commands, "view.graph").run();
    void find(commands, "view.sidebar").run();
    void find(commands, "view.agents").run();
    void find(commands, "theme.auto").run();
    void find(commands, "theme.toggle").run();
    void find(commands, "theme.import").run();
    void find(commands, "theme.export").run();
    expect(stores.library.newNote).toHaveBeenCalledOnce();
    expect(stores.library.newWhiteboard).toHaveBeenCalledOnce();
    expect(stores.library.newSheet).toHaveBeenCalledOnce();
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

describe("the commands every surface shares", () => {
  it("offers settings, the palette, zoom and the app commands", () => {
    const commands = buildCommands();
    const got = ids(commands);
    for (const id of [
      "view.settings",
      "view.about",
      "view.palette",
      "view.zoomIn",
      "view.zoomOut",
      "view.zoomReset",
      "view.toolbar",
      "view.markdownSource",
      "app.checkUpdates",
      "app.sendFeedback",
      "app.openRepo",
      "app.openChangelog",
      "app.openDataFolder",
      "app.quit",
      "data.backups",
      "data.export",
      "data.backupNow",
    ]) {
      expect(got).toContain(id);
    }
    expect(got).not.toContain("app.showUpdate");
    expect(find(commands, "view.palette").hidden).toBe(true);
  });

  it("runs them against their stores", async () => {
    const commands = buildCommands();
    void find(commands, "view.settings").run();
    expect(stores.shell.openSettings).toHaveBeenCalledWith();
    void find(commands, "view.about").run();
    expect(stores.shell.openSettings).toHaveBeenCalledWith("about");
    void find(commands, "app.sendFeedback").run();
    expect(stores.shell.openSettings).toHaveBeenCalledWith("feedback");
    void find(commands, "view.palette").run();
    expect(stores.shell.togglePalette).toHaveBeenCalledOnce();
    void find(commands, "view.zoomIn").run();
    void find(commands, "view.zoomOut").run();
    void find(commands, "view.zoomReset").run();
    expect(stores.editorPrefs.zoomIn).toHaveBeenCalledOnce();
    expect(stores.editorPrefs.zoomOut).toHaveBeenCalledOnce();
    expect(stores.editorPrefs.resetZoom).toHaveBeenCalledOnce();
    void find(commands, "app.openRepo").run();
    expect(stores.client.openUrl).toHaveBeenCalledWith("https://github.com/Jam-Sw/InstantNotes");
    void find(commands, "app.openDataFolder").run();
    expect(stores.client.openDataFolder).toHaveBeenCalledOnce();
    void find(commands, "app.quit").run();
    expect(stores.client.requestQuit).toHaveBeenCalledOnce();
    void find(commands, "data.backups").run();
    expect(stores.shell.openSettings).toHaveBeenCalledWith("backups");
    await find(commands, "data.export").run();
    expect(stores.vaultExport.exportVaultToFolder).toHaveBeenCalledOnce();
    expect(stores.toasts.show).toHaveBeenLastCalledWith(expect.stringContaining("Exported."));
    await find(commands, "data.backupNow").run();
    expect(stores.client.backupNow).toHaveBeenCalledOnce();
    expect(stores.toasts.show).toHaveBeenLastCalledWith(expect.stringContaining("Backed up."));
  });

  it("reports an export that was refused and says nothing about one that was cancelled", async () => {
    const commands = buildCommands();
    stores.vaultExport.exportVaultToFolder.mockResolvedValueOnce({ cancelled: true } as never);
    await find(commands, "data.export").run();
    expect(stores.toasts.show).not.toHaveBeenCalled();
    stores.vaultExport.exportVaultToFolder.mockResolvedValueOnce({ ok: false, error: "disk full" } as never);
    await find(commands, "data.export").run();
    expect(stores.toasts.show).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("names the toolbar and source commands for what they will do", () => {
    let commands = buildCommands();
    expect(find(commands, "view.toolbar").title).toBe("Hide formatting toolbar");
    expect(find(commands, "view.markdownSource").title).toBe("Show Markdown source");
    void find(commands, "view.toolbar").run();
    void find(commands, "view.markdownSource").run();
    expect(stores.editorPrefs.toggleToolbar).toHaveBeenCalledOnce();
    expect(stores.editorPrefs.toggleSourceMode).toHaveBeenCalledOnce();
    stores.editorPrefs.toolbarOpen = false;
    stores.editorPrefs.sourceMode = true;
    commands = buildCommands();
    expect(find(commands, "view.toolbar").title).toBe("Show formatting toolbar");
    expect(find(commands, "view.markdownSource").title).toBe("Hide Markdown source");
    stores.editorPrefs.toolbarOpen = true;
    stores.editorPrefs.sourceMode = false;
  });

  it("closes Settings before showing a new note or the graph", () => {
    const commands = buildCommands();
    void find(commands, "note.new").run();
    void find(commands, "view.graph").run();
    expect(stores.shell.closeSettings).toHaveBeenCalledTimes(2);
  });

  it("checks for updates from Settings > About and shows a found update", async () => {
    stores.updater.checkNow.mockImplementation(async () => {
      stores.updater.pendingUpdate = true;
      stores.updater.version = "0.10.1";
    });
    await find(buildCommands(), "app.checkUpdates").run();
    expect(stores.shell.openSettings).toHaveBeenCalledWith("about");
    expect(stores.updater.checkNow).toHaveBeenCalledWith({ manual: true });
    expect(stores.updater.show).toHaveBeenCalledOnce();
    const show = find(buildCommands(), "app.showUpdate");
    expect(show.title).toBe("Show update v0.10.1");
    void show.run();
    expect(stores.updater.show).toHaveBeenCalledTimes(2);
  });

  it("exports the open note", () => {
    stores.library.selected = note();
    void find(buildCommands(), "note.export").run();
    expect(stores.exportSelectedNote).toHaveBeenCalledOnce();
  });
});

describe("runCommand", () => {
  it("runs a known id and ignores an unknown one", async () => {
    await runCommand("note.new");
    await runCommand("no.such");
    expect(stores.library.newNote).toHaveBeenCalledOnce();
  });

  it("does nothing while the licence lock is on", async () => {
    stores.licenseSpace.locked = true;
    await runCommand("note.new");
    expect(stores.library.newNote).not.toHaveBeenCalled();
  });
});

describe("the menus and the tray", () => {
  const source = readFileSync(`${process.cwd()}/src-tauri/src/shell/menu.rs`, "utf8");
  const menuIds = [...source.matchAll(/Item::new\("([^"]+)"/g)].map((m) => m[1]);
  const shellOnly = [...source.match(/SHELL_ONLY: &\[&str\] = &\[([^\]]+)\]/)![1].matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );

  it("run commands the registry knows", () => {
    stores.library.selected = note();
    stores.updater.pendingUpdate = true;
    stores.updater.version = "0.10.1";
    const known = new Set(ids(buildCommands()));
    expect(menuIds.length).toBeGreaterThan(10);
    for (const id of menuIds) {
      if (shellOnly.includes(id)) continue;
      expect(known.has(id), id).toBe(true);
    }
  });
});
