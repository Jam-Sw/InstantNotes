import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";

const { newNote, newWhiteboard, copyIds, restoreIds, write, searchNow, moveSelection, toggleScopedTag, list } = vi.hoisted(() => ({
  newNote: vi.fn(),
  write: vi.fn(async () => {}),
  searchNow: vi.fn(async () => {}),
  moveSelection: vi.fn(async () => null),
  toggleScopedTag: vi.fn(),
  restoreIds: vi.fn(async () => {}),
  newWhiteboard: vi.fn(),
  copyIds: vi.fn(async () => {}),
  list: {
    notes: [] as Record<string, unknown>[],
    selected: new Set<string>(),
    searchText: "",
    searchResults: null as { noteId: string; title: string; excerpt: string; updatedAt: string }[] | null,
    activeWorkspaceId: null as string | null,
    scopedTagId: null as string | null,
  },
}));

function noteRow(id: string, title: string) {
  return {
    id,
    title,
    body: "",
    updatedAt: "2026-10-15T10:00:00.000Z",
    createdAt: "2026-10-15T10:00:00.000Z",
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "markdown",
  };
}

vi.mock("$lib/stores/library.svelte", () => ({
  library: {
    get notes() {
      return list.notes;
    },
    get visibleIds() {
      return list.searchResults ? list.searchResults.map((h) => h.noteId) : list.notes.map((n) => n.id as string);
    },
    get multiSelected() {
      return list.selected;
    },
    isSticky: () => false,
    flushPendingEdits: vi.fn(async () => {}),
    get searchText() {
      return list.searchText;
    },
    get searchResults() {
      return list.searchResults;
    },
    get activeWorkspaceId() {
      return list.activeWorkspaceId;
    },
    get scopedTagId() {
      return list.scopedTagId;
    },
    selected: null,
    activeTagId: null,
    workspaceTags: [{ id: "t1", name: "trip", usageCount: 2 }],
    workspaces: [{ id: "w1", name: "Garden" }],
    tags: [],
    revisitMode: false,
    statusFilter: "active",
    isSelected: (id: string) => list.selected.has(id),
    newNote,
    newWhiteboard,
    select: vi.fn(),
    selectVirtual: vi.fn(),
    setSearch: vi.fn(),
    setStatusFilter: vi.fn(),
    toggleInSelection: vi.fn(),
    toggleScopedTag,
    write,
    searchNow,
    moveSelection,
    extendSelectionTo: vi.fn(),
    emptyTrash: vi.fn(),
    restoreIds,
  },
}));
vi.mock("$lib/stores/update-space", () => ({ updateSpace: { notes: [] } }));
vi.mock("$lib/stores/license-space.svelte", () => ({ licenseSpace: { locked: false } }));

vi.mock("$lib/stores/contexting.svelte", () => ({ contexting: { copyIds } }));

import NoteList from "./NoteList.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

afterEach(() => {
  list.notes = [];
  list.selected = new Set();
  list.searchText = "";
  list.searchResults = null;
  list.activeWorkspaceId = null;
  list.scopedTagId = null;
  for (const t of [...toasts.items]) toasts.dismiss(t.id);
  cleanup();
  vi.clearAllMocks();
});

describe("NoteList create control", () => {
  it("creates a document on ＋, without opening the menu", async () => {
    const { getByTitle, queryByRole } = render(NoteList);
    await fireEvent.click(getByTitle(/^New note/));
    expect(newNote).toHaveBeenCalledTimes(1);
    expect(queryByRole("menu")).toBeNull();
  });

  it("offers both kinds from the chevron, and starts a whiteboard", async () => {
    const { getByLabelText, getByRole, findByRole } = render(NoteList);
    await fireEvent.click(getByLabelText("Choose what to create"));

    const menu = await findByRole("menu");
    expect(menu.textContent).toContain("New note");
    expect(menu.textContent).toContain("New whiteboard");

    await fireEvent.click(getByRole("menuitem", { name: /New whiteboard/ }));
    await waitFor(() => expect(newWhiteboard).toHaveBeenCalledTimes(1));
    expect(newNote).not.toHaveBeenCalled();
  });

  it("opens the same menu on right-click anywhere on the control", async () => {
    const { getByTitle, findByRole } = render(NoteList);
    await fireEvent.contextMenu(getByTitle(/^New note/));
    expect((await findByRole("menu")).textContent).toContain("New whiteboard");
  });
});

describe("NoteList copy context", () => {
  it("copies the right-clicked note", async () => {
    list.notes = [noteRow("n1", "One"), noteRow("n2", "Two")];
    const { container, findByRole, getByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n2"]')!);
    expect((await findByRole("menu")).textContent).toContain("Copy context");
    await fireEvent.click(getByRole("menuitem", { name: "Copy context" }));
    await waitFor(() => expect(copyIds).toHaveBeenCalledWith(["n2"]));
  });

  it("copies the whole selection, in list order, when the clicked note is part of it", async () => {
    list.notes = [noteRow("n1", "One"), noteRow("n2", "Two"), noteRow("n3", "Three")];
    list.selected = new Set(["n3", "n1"]);
    const { container, getByRole, findByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n3"]')!);
    await findByRole("menu");
    await fireEvent.click(getByRole("menuitem", { name: "Copy context (2 notes)" }));
    await waitFor(() => expect(copyIds).toHaveBeenCalledWith(["n1", "n3"]));
  });

  it("copies only the clicked note when it sits outside the selection", async () => {
    list.notes = [noteRow("n1", "One"), noteRow("n2", "Two"), noteRow("n3", "Three")];
    list.selected = new Set(["n1", "n2"]);
    const { container, getByRole, findByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n3"]')!);
    await findByRole("menu");
    await fireEvent.click(getByRole("menuitem", { name: "Copy context" }));
    await waitFor(() => expect(copyIds).toHaveBeenCalledWith(["n3"]));
  });

  it("says so when the copy fails instead of leaving the clipboard silently empty", async () => {
    copyIds.mockRejectedValueOnce(new Error("NotAllowedError"));
    list.notes = [noteRow("n1", "One")];
    const { container, findByRole, getByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n1"]')!);
    await findByRole("menu");
    await fireEvent.click(getByRole("menuitem", { name: "Copy context" }));
    await waitFor(() => expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("Couldn't copy")]));
  });
});

describe("NoteList trash menu", () => {
  const trashed = (id: string, title: string) => ({ ...noteRow(id, title), isDeleted: true });

  it("copies the context of a trashed note, and offers Restore in place of the sticky items", async () => {
    list.notes = [trashed("n1", "One")];
    const { container, findByRole, getByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n1"]')!);
    const menu = await findByRole("menu");
    expect(menu.textContent).not.toContain("sticky");
    await fireEvent.click(getByRole("menuitem", { name: "Copy context" }));
    await waitFor(() => expect(copyIds).toHaveBeenCalledWith(["n1"]));
  });

  it("restores the whole selection when the clicked note is part of it", async () => {
    list.notes = [trashed("n1", "One"), trashed("n2", "Two"), trashed("n3", "Three")];
    list.selected = new Set(["n3", "n1"]);
    const { container, findByRole, getByRole } = render(NoteList);
    await fireEvent.contextMenu(container.querySelector('[data-note-id="n1"]')!);
    await findByRole("menu");
    await fireEvent.click(getByRole("menuitem", { name: "Restore 2 notes" }));
    await waitFor(() => expect(restoreIds).toHaveBeenCalledWith(["n1", "n3"]));
  });
});

describe("NoteList search keys", () => {
  const hit = (noteId: string, title: string) => ({ noteId, title, excerpt: "", updatedAt: "2026-10-15T10:00:00.000Z" });

  it("counts the results and marks the first as the one Enter opens", () => {
    list.searchText = "trip";
    list.searchResults = [hit("a", "Trip plan"), hit("b", "Trip photos")];
    const { container, getByText } = render(NoteList);
    expect(getByText("2 notes")).toBeTruthy();
    expect(container.querySelector(".note-row.target")?.getAttribute("data-note-id")).toBe("a");
  });

  it("moves through the list from the search field and opens the first result into the editor on Enter", async () => {
    list.searchText = "trip";
    list.searchResults = [hit("a", "Trip plan"), hit("b", "Trip photos")];
    const { container } = render(NoteList);
    const input = container.querySelector<HTMLInputElement>("input.search")!;
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(moveSelection).toHaveBeenCalledWith(1);
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(write).toHaveBeenCalledWith("a"));
    expect(searchNow).toHaveBeenCalled();
  });

  it("creates nothing on Enter when nothing matches, and starts a note only from the button", async () => {
    list.searchText = "pear tart";
    list.searchResults = [];
    const { container, getByRole } = render(NoteList);
    await fireEvent.keyDown(container.querySelector("input.search")!, { key: "Enter" });
    await waitFor(() => expect(searchNow).toHaveBeenCalled());
    expect(newNote).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Start a note called “pear tart”" }));
    expect(newNote).toHaveBeenCalledWith("pear tart\n");
  });

  it("leaves Enter alone with an empty search and nothing open", async () => {
    list.notes = [noteRow("n1", "One")];
    const { container } = render(NoteList);
    await fireEvent.keyDown(container.querySelector("input.search")!, { key: "Enter" });
    expect(write).not.toHaveBeenCalled();
    expect(newNote).not.toHaveBeenCalled();
  });
});

describe("NoteList empty states", () => {
  it("names an empty space and offers a note in it", async () => {
    list.activeWorkspaceId = "w1";
    const { getByText, getByRole } = render(NoteList);
    expect(getByText("Nothing in Garden yet")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "New note" }));
    expect(newNote).toHaveBeenCalledTimes(1);
  });

  it("offers the whole space back when a tag slice is empty", async () => {
    list.activeWorkspaceId = "w1";
    list.scopedTagId = "t1";
    const { getByText, getByRole } = render(NoteList);
    expect(getByText("No #trip notes in this space")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Show the whole space" }));
    expect(toggleScopedTag).toHaveBeenCalledWith("t1");
  });

  it("starts the first note from an empty library", async () => {
    const { getByText, getByRole } = render(NoteList);
    expect(getByText("No notes yet")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "New note" }));
    expect(newNote).toHaveBeenCalledTimes(1);
  });
});
