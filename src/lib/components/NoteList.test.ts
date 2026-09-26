// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";

// The toolbar is the only visible place a note can be started from, so the
// store is mocked down to what it reads and what the two create paths call.
const { newNote, newWhiteboard } = vi.hoisted(() => ({
  newNote: vi.fn(),
  newWhiteboard: vi.fn(),
}));

vi.mock("$lib/stores/library.svelte", () => ({
  library: {
    notes: [],
    searchText: "",
    searchResults: null,
    activeTagId: null,
    activeWorkspaceId: null,
    scopedTagId: null,
    workspaceTags: [],
    revisitMode: false,
    statusFilter: "active",
    isSelected: () => false,
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
  },
}));
vi.mock("$lib/stores/update-space", () => ({ updateSpace: { notes: [] } }));

import NoteList from "./NoteList.svelte";

afterEach(() => {
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
