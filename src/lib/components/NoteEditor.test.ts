import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

const { library } = vi.hoisted(() => ({
  library: {
    selected: null as Record<string, unknown> | null,
    focusRequest: null as { id: string; atEnd: boolean } | null,
    suggestions: [] as unknown[],
    selectedTags: [] as unknown[],
    selectedWorkspaces: [] as unknown[],
    workspaces: [] as unknown[],
    saveState: "saved",
    error: null as string | null,
    isSticky: () => false,
    editTitle: vi.fn(),
    editBody: vi.fn(),
    onBeforeFlush: vi.fn(),
  },
}));

vi.mock("$lib/stores/library.svelte", () => ({ library }));
vi.mock("$lib/stores/agents.svelte", () => ({
  agents: { lastWriter: () => null, noteMark: () => null },
}));
vi.mock("$lib/stores/editor.svelte", () => ({
  editorPrefs: {
    toolbarOpen: false,
    sourceMode: false,
    zoom: 1,
    showExactTime: false,
    toggleToolbar: vi.fn(),
    toggleSourceMode: vi.fn(),
  },
}));
vi.mock("$lib/stores/images.svelte", () => ({
  imagePrefs: { storage: "copy", maxPreviewHeight: 400 },
}));
vi.mock("$lib/stores/theme.svelte", () => ({
  theme: { activeTheme: "default", resolvedVariant: "light" },
}));
vi.mock("$lib/api/client", () => ({
  getAttachmentsDir: vi.fn().mockResolvedValue("/data/attachments"),
  openUrl: vi.fn().mockResolvedValue(undefined),
  saveAttachment: vi.fn().mockResolvedValue("x.png"),
  allowImageFile: vi.fn().mockResolvedValue(undefined),
  importImageFile: vi.fn().mockResolvedValue("x.png"),
  popOutNote: vi.fn(),
  tagSuggestion: vi.fn().mockResolvedValue(null),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import NoteEditor from "./NoteEditor.svelte";

function note(overrides: Record<string, unknown>) {
  return {
    id: "n1",
    title: "Plan for the launch",
    body: "Some body text",
    contentKind: "text",
    isDeleted: false,
    isPinned: false,
    isArchived: false,
    updatedAt: 1_700_000_000_000,
    surfaceData: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  library.selected = null;
  library.focusRequest = null;
});

describe("NoteEditor header", () => {
  it("names the open note in the header bar", () => {
    library.selected = note({});
    const { container } = render(NoteEditor);
    expect(container.querySelector(".editor-header .header-title")?.textContent).toBe("Plan for the launch");
  });

  it("falls back to Untitled when the note has no title", () => {
    library.selected = note({ title: "" });
    const { container } = render(NoteEditor);
    expect(container.querySelector(".editor-header .header-title")?.textContent).toBe("Untitled");
  });

  it("names a virtual release-notes note and offers none of its actions", () => {
    library.selected = note({ id: "update-release-notes", title: "Release notes 0.9.4" });
    const { container } = render(NoteEditor);
    expect(container.querySelector(".editor-header .header-title")?.textContent).toBe("Release notes 0.9.4");
    expect(container.querySelectorAll(".editor-header .icon-btn")).toHaveLength(0);
  });

  it("keeps Restore and Delete forever on a trashed note", () => {
    library.selected = note({ isDeleted: true });
    const { getByRole } = render(NoteEditor);
    expect(getByRole("button", { name: "Restore from Trash" })).toBeTruthy();
    expect(getByRole("button", { name: "Delete forever" })).toBeTruthy();
  });
});

describe("NoteEditor cursor handoff", () => {
  it("takes the cursor into the body when the open note asks for it", () => {
    library.selected = note({ id: "n1", body: "pear tart\n" });
    library.focusRequest = { id: "n1", atEnd: true };
    const { container } = render(NoteEditor);
    const content = container.querySelector(".cm-content");
    expect(content?.contains(document.activeElement)).toBe(true);
    expect(library.focusRequest).toBeNull();
  });

  it("drops a request meant for another note", () => {
    library.selected = note({ id: "n1" });
    library.focusRequest = { id: "n2", atEnd: false };
    const { container } = render(NoteEditor);
    expect(container.querySelector(".cm-content")?.contains(document.activeElement)).toBe(false);
    expect(library.focusRequest).toBeNull();
  });

  it("moves from the title to the body on Enter", async () => {
    library.selected = note({});
    const { container, getByLabelText } = render(NoteEditor);
    const title = getByLabelText("Note title");
    title.focus();
    await fireEvent.keyDown(title, { key: "Enter" });
    expect(library.editTitle).toHaveBeenCalled();
    expect(container.querySelector(".cm-content")?.contains(document.activeElement)).toBe(true);
  });
});
