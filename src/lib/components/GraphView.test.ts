// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import GraphView from "./GraphView.svelte";
import { libraryGraph } from "$lib/api/client";
import { library } from "$lib/stores/library.svelte";
import { listen } from "@tauri-apps/api/event";
import type { LibraryGraph } from "$lib/api/types";

vi.mock("$lib/api/client", () => ({ libraryGraph: vi.fn() }));
vi.mock("$lib/stores/library.svelte", () => ({
  library: {
    selected: null,
    select: vi.fn(),
    setTagFilter: vi.fn(),
    selectWorkspace: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const lib = library as unknown as {
  selected: { id: string } | null;
  select: ReturnType<typeof vi.fn>;
  setTagFilter: ReturnType<typeof vi.fn>;
  selectWorkspace: ReturnType<typeof vi.fn>;
};

const note = (id: string, title: string) => ({
  id,
  title,
  contentKind: "document" as const,
  isPinned: false,
});

const GRAPH: LibraryGraph = {
  notes: [note("n1", "Alpha"), note("n2", "Beta"), note("n3", "Loose")],
  tags: [{ id: "t1", name: "ideas" }],
  spaces: [{ id: "s1", name: "Research" }],
  links: [
    { noteId: "n1", targetId: "t1", kind: "tag" },
    { noteId: "n2", targetId: "s1", kind: "space" },
  ],
};

let handlers: Record<string, () => void> = {};

beforeEach(() => {
  handlers = {};
  lib.selected = null;
  lib.select.mockReset();
  lib.setTagFilter.mockReset();
  lib.selectWorkspace.mockReset();
  vi.mocked(libraryGraph).mockReset().mockResolvedValue(GRAPH);
  vi.mocked(listen).mockReset().mockImplementation(async (event, handler) => {
    handlers[event] = handler as () => void;
    return () => {};
  });
});

afterEach(cleanup);

describe("GraphView", () => {
  it("draws every connected note, tag, and Space as a button", async () => {
    const { findByRole, getByRole } = render(GraphView);
    expect(await findByRole("button", { name: "Note: Alpha" })).toBeTruthy();
    expect(getByRole("button", { name: "Note: Beta" })).toBeTruthy();
    expect(getByRole("button", { name: "Tag: #ideas" })).toBeTruthy();
    expect(getByRole("button", { name: "Space: Research" })).toBeTruthy();
  });

  it("says how many notes it leaves out, and why", async () => {
    const { findByText } = render(GraphView);
    expect(await findByText(/1 note with no tags or Spaces isn't shown/)).toBeTruthy();
  });

  it("opens a note, filters by a tag, and goes into a Space", async () => {
    const { findByRole, getByRole } = render(GraphView);
    await fireEvent.click(await findByRole("button", { name: "Note: Alpha" }));
    expect(lib.select).toHaveBeenCalledWith("n1");
    await fireEvent.click(getByRole("button", { name: "Tag: #ideas" }));
    expect(lib.setTagFilter).toHaveBeenCalledWith("t1");
    await fireEvent.click(getByRole("button", { name: "Space: Research" }));
    expect(lib.selectWorkspace).toHaveBeenCalledWith("s1");
  });

  it("works from the keyboard", async () => {
    const { findByRole } = render(GraphView);
    await fireEvent.keyDown(await findByRole("button", { name: "Note: Beta" }), { key: "Enter" });
    expect(lib.select).toHaveBeenCalledWith("n2");
  });

  it("explains itself when nothing is connected yet", async () => {
    vi.mocked(libraryGraph).mockResolvedValue({ ...GRAPH, links: [] });
    const { findByText } = render(GraphView);
    expect(await findByText(/Tag notes or add them to Spaces/)).toBeTruthy();
  });

  it("redraws when notes, tags, or Spaces change", async () => {
    render(GraphView);
    await waitFor(() => expect(libraryGraph).toHaveBeenCalledTimes(1));
    for (const event of ["notes:changed", "tags:changed", "workspaces:changed"]) {
      expect(handlers[event]).toBeTypeOf("function");
    }
    handlers["notes:changed"]();
    await waitFor(() => expect(libraryGraph).toHaveBeenCalledTimes(2));
  });
});
