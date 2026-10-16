import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";

const { newNote, newWhiteboard, copyIds, restoreIds, list } = vi.hoisted(() => ({
  newNote: vi.fn(),
  restoreIds: vi.fn(async () => {}),
  newWhiteboard: vi.fn(),
  copyIds: vi.fn(async () => {}),
  list: {
    notes: [] as Record<string, unknown>[],
    selected: new Set<string>(),
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
      return list.notes.map((n) => n.id as string);
    },
    get multiSelected() {
      return list.selected;
    },
    isSticky: () => false,
    flushPendingEdits: vi.fn(async () => {}),
    searchText: "",
    searchResults: null,
    activeTagId: null,
    activeWorkspaceId: null,
    scopedTagId: null,
    workspaceTags: [],
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
    toggleScopedTag: vi.fn(),
    extendSelectionTo: vi.fn(),
    emptyTrash: vi.fn(),
    restoreIds,
  },
}));
vi.mock("$lib/stores/update-space", () => ({ updateSpace: { notes: [] } }));
vi.mock("$lib/stores/license-space.svelte", () => ({ licenseSpace: { locked: false } }));

vi.mock("$lib/stores/contexting.svelte", () => ({ contexting: { copyIds } }));

import NoteList from "./NoteList.svelte";

afterEach(() => {
  list.notes = [];
  list.selected = new Set();
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
