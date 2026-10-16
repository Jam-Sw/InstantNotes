import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import WelcomeScreen from "./WelcomeScreen.svelte";
import { getShortcutFailure, listNotes } from "$lib/api/client";

const { panes, lib } = vi.hoisted(() => ({
  panes: { listInline: true },
  lib: {
    error: null,
    notes: [] as unknown[],
    searchText: "",
    searchResults: null as unknown[] | null,
    write: vi.fn(),
    newNote: vi.fn(async () => null),
    searchNow: vi.fn(async () => {}),
    setSearch: vi.fn(),
  },
}));

vi.mock("$lib/api/client", () => ({ getShortcutFailure: vi.fn(), listNotes: vi.fn() }));
vi.mock("$lib/stores/library.svelte", () => ({ library: lib }));
vi.mock("$lib/stores/updater.svelte", () => ({ updater: { pendingUpdate: null } }));
vi.mock("$lib/stores/sidebar.svelte", () => ({ sidebar: panes }));
vi.mock("$lib/stores/agents.svelte", () => ({ agents: { currentSearch: null } }));

function opened(id: string, title: string, lastOpenedAt: string | null) {
  return {
    id,
    title,
    body: "",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    lastOpenedAt,
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document",
  };
}

const props = { appVersion: "0.11.0", onOpenUpdate: () => {} };

beforeEach(() => {
  vi.mocked(getShortcutFailure).mockResolvedValue(null);
  panes.listInline = true;
  lib.searchText = "";
  lib.searchResults = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WelcomeScreen", () => {
  it("says another app owns the shortcut when registering it failed", async () => {
    vi.mocked(getShortcutFailure).mockResolvedValue({ label: "Ctrl+Shift+Space", wayland: false });
    const { findByText } = render(WelcomeScreen, props);
    expect(await findByText(/another app likely owns it/)).toBeTruthy();
  });

  it("points a Wayland desktop at the capture command", async () => {
    vi.mocked(getShortcutFailure).mockResolvedValue({ label: "Ctrl+Shift+Space", wayland: true });
    const { findByText, queryByText } = render(WelcomeScreen, props);
    expect(await findByText("instantnotes capture")).toBeTruthy();
    expect(queryByText(/another app likely owns it/)).toBeNull();
  });
});

describe("WelcomeScreen with the note list hidden", () => {
  it("adds nothing while the list is beside it", async () => {
    const { container, queryByText } = render(WelcomeScreen, props);
    await Promise.resolve();
    expect(container.querySelector("input.search")).toBeNull();
    expect(queryByText("Continue")).toBeNull();
    expect(listNotes).not.toHaveBeenCalled();
  });

  it("offers the search and the notes last opened, newest first, and opens one", async () => {
    panes.listInline = false;
    vi.mocked(listNotes).mockResolvedValue([
      opened("n2", "Trip plan", "2026-10-15T09:00:00Z"),
      opened("n1", "Groceries", "2026-10-14T09:00:00Z"),
      opened("n3", "Never opened", null),
    ] as never);
    const { container, findByText, getByText, queryByText } = render(WelcomeScreen, props);
    expect(container.querySelector("input.search")).toBeTruthy();
    expect(await findByText("Continue")).toBeTruthy();
    expect(listNotes).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "lastOpenedAt", sortOrder: "desc" }),
    );
    const titles = [...container.querySelectorAll(".recent-title")].map((el) => el.textContent);
    expect(titles).toEqual(["Trip plan", "Groceries"]);
    expect(queryByText("Never opened")).toBeNull();
    await fireEvent.click(getByText("Groceries"));
    expect(lib.write).toHaveBeenCalledWith("n1");
  });

  it("shows the results of a typed search in place, and opens one from the keyboard", async () => {
    panes.listInline = false;
    vi.mocked(listNotes).mockResolvedValue([opened("n1", "Groceries", "2026-10-14T09:00:00Z")] as never);
    lib.searchText = "trip";
    lib.searchResults = ["Trip plan", "Trip photos"].map((title, i) => ({
      noteId: `t${i}`,
      title,
      excerpt: "the \u0001trip\u0002 north",
      score: 1,
      updatedAt: "2026-10-15T09:00:00Z",
    }));
    const { container, getByText, queryByText } = render(WelcomeScreen, props);
    expect(getByText("Results")).toBeTruthy();
    expect(queryByText("Groceries")).toBeNull();
    const titles = [...container.querySelectorAll(".recent-title")].map((el) => el.textContent);
    expect(titles).toEqual(["Trip plan", "Trip photos"]);
    expect(container.querySelector(".recent-excerpt mark")?.textContent).toBe("trip");
    const input = container.querySelector<HTMLInputElement>("input.search")!;
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(lib.write).toHaveBeenCalledWith("t1");
    await fireEvent.input(input, { target: { value: "trips" } });
    expect(lib.setSearch).toHaveBeenCalledWith("trips");
  });

  it("says so when nothing matches, and starts a note with the words on Enter", async () => {
    panes.listInline = false;
    vi.mocked(listNotes).mockResolvedValue([]);
    lib.searchText = "zzz";
    lib.searchResults = [];
    const { container, getByText } = render(WelcomeScreen, props);
    expect(getByText("No notes match")).toBeTruthy();
    expect(getByText("Start a note called “zzz”")).toBeTruthy();
    const input = container.querySelector<HTMLInputElement>("input.search")!;
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(lib.newNote).toHaveBeenCalledWith("zzz\n"));
    expect(lib.searchNow).toHaveBeenCalled();
  });
});
