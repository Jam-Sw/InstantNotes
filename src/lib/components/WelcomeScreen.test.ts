import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import WelcomeScreen from "./WelcomeScreen.svelte";
import { getShortcutFailure, listNotes } from "$lib/api/client";
import { focusSearch } from "$lib/search-focus";

const { panes, lib } = vi.hoisted(() => ({
  panes: { listHidden: false },
  lib: {
    error: null,
    notes: [] as unknown[],
    searchText: "",
    select: vi.fn(),
    setSearch: vi.fn(),
  },
}));

vi.mock("$lib/api/client", () => ({ getShortcutFailure: vi.fn(), listNotes: vi.fn() }));
vi.mock("$lib/stores/library.svelte", () => ({ library: lib }));
vi.mock("$lib/stores/updater.svelte", () => ({ updater: { pendingUpdate: null } }));
vi.mock("$lib/stores/sidebar.svelte", () => ({ sidebar: panes }));
vi.mock("$lib/stores/agents.svelte", () => ({ agents: { currentSearch: null } }));
vi.mock("$lib/search-focus", () => ({ focusSearch: vi.fn(async () => true) }));

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
  panes.listHidden = false;
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
    panes.listHidden = true;
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
    expect(lib.select).toHaveBeenCalledWith("n1");
  });

  it("carries typing over to the list's search field", async () => {
    panes.listHidden = true;
    vi.mocked(listNotes).mockResolvedValue([]);
    const { container, queryByText } = render(WelcomeScreen, props);
    await waitFor(() => expect(listNotes).toHaveBeenCalled());
    expect(queryByText("Continue")).toBeNull();
    await fireEvent.input(container.querySelector("input.search")!, { target: { value: "trip" } });
    expect(lib.setSearch).toHaveBeenCalledWith("trip");
    expect(focusSearch).toHaveBeenCalledWith(document, { select: false });
  });
});
