import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, within } from "@testing-library/svelte";
import GraphView from "./GraphView.svelte";
import {
  addNoteToWorkspace,
  dismissSpaceSuggestion,
  libraryGraph,
  removeNoteFromWorkspace,
  restoreSpaceSuggestion,
  spaceSuggestions,
} from "$lib/api/client";
import { library } from "$lib/stores/library.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { listen } from "@tauri-apps/api/event";
import type { LibraryGraph, SpaceSuggestion } from "$lib/api/types";

vi.mock("$lib/api/client", () => ({
  libraryGraph: vi.fn(),
  spaceSuggestions: vi.fn(),
  addNoteToWorkspace: vi.fn(),
  removeNoteFromWorkspace: vi.fn(),
  dismissSpaceSuggestion: vi.fn(),
  restoreSpaceSuggestion: vi.fn(),
}));
vi.mock("$lib/stores/library.svelte", () => ({
  library: {
    selected: null,
    select: vi.fn(),
    setTagFilter: vi.fn(),
    selectWorkspace: vi.fn(),
    refreshSuggestionCount: vi.fn(),
  },
}));
vi.mock("$lib/stores/toasts.svelte", () => ({ toasts: { show: vi.fn() } }));
const agentsMock = vi.hoisted(() => ({ recent: [] as unknown[] }));
vi.mock("$lib/stores/agents.svelte", () => ({ agents: agentsMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const lib = library as unknown as {
  selected: { id: string } | null;
  select: ReturnType<typeof vi.fn>;
  setTagFilter: ReturnType<typeof vi.fn>;
  selectWorkspace: ReturnType<typeof vi.fn>;
  refreshSuggestionCount: ReturnType<typeof vi.fn>;
};
const show = vi.mocked(toasts.show);

const note = (id: string, title: string) => ({
  id,
  title,
  contentKind: "document" as const,
  isPinned: false,
});

const GRAPH: LibraryGraph = {
  notes: [note("n1", "Alpha"), note("n2", "Beta"), note("n3", "Loose"), note("n4", "Lasagne")],
  tags: [{ id: "t1", name: "ideas" }],
  spaces: [{ id: "s1", name: "Research" }],
  links: [
    { noteId: "n1", targetId: "t1", kind: "tag", source: "inline" },
    { noteId: "n2", targetId: "s1", kind: "space" },
  ],
};

const SUGGESTION: SpaceSuggestion = {
  noteId: "n4",
  noteTitle: "Lasagne",
  spaceId: "s1",
  spaceName: "Research",
  probability: 0.84,
  reasons: [
    { label: "#pasta", kind: "tag" },
    { label: "simmer", kind: "word" },
    { label: "ragu", kind: "word" },
  ],
};

let handlers: Record<string, () => void> = {};

beforeEach(() => {
  handlers = {};
  agentsMock.recent = [];
  lib.selected = null;
  lib.select.mockReset();
  lib.setTagFilter.mockReset();
  lib.selectWorkspace.mockReset();
  lib.refreshSuggestionCount.mockReset();
  show.mockReset();
  vi.mocked(libraryGraph).mockReset().mockResolvedValue(GRAPH);
  vi.mocked(spaceSuggestions).mockReset().mockResolvedValue([]);
  vi.mocked(addNoteToWorkspace).mockReset().mockResolvedValue(undefined);
  vi.mocked(removeNoteFromWorkspace).mockReset().mockResolvedValue(undefined);
  vi.mocked(dismissSpaceSuggestion).mockReset().mockResolvedValue(undefined);
  vi.mocked(restoreSpaceSuggestion).mockReset().mockResolvedValue(undefined);
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

  it("rings a note an agent wrote and says so", async () => {
    agentsMock.recent = [
      { kind: "write", status: "ok", client: "claude-code", revertedAt: null, noteIds: ["n1"] },
      { kind: "write", status: "ok", client: "claude-code", revertedAt: 5, noteIds: ["n2"] },
    ];
    const { findByRole, getByRole } = render(GraphView);
    const written = await findByRole("button", { name: "Note: Alpha, written by an agent" });
    expect(written.querySelector(".agent-ring")).not.toBeNull();
    expect(getByRole("button", { name: "Note: Beta" }).querySelector(".agent-ring")).toBeNull();
  });

  it("shortens a long title on the canvas and keeps the whole name for screen readers", async () => {
    const title = "A".repeat(60);
    vi.mocked(libraryGraph).mockResolvedValue({
      ...GRAPH,
      notes: [...GRAPH.notes, note("n5", title)],
      links: [...GRAPH.links, { noteId: "n5", targetId: "t1", kind: "tag", source: "inline" }],
    });
    lib.selected = { id: "n5" };
    const { findByRole, container } = render(GraphView);
    await findByRole("button", { name: `Note: ${title}` });
    const drawn = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(drawn).toContain(`${"A".repeat(27)}…`);
  });

  it("says how many notes it leaves out, and when suggestions will start", async () => {
    const { findByText } = render(GraphView);
    expect(
      await findByText(/2 notes with no tags or Spaces aren't shown\.\s+Suggestions start once two Spaces hold notes\./),
    ).toBeTruthy();
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
    expect(spaceSuggestions).toHaveBeenCalledTimes(2);
  });

  it("names every edge kind in a legend", async () => {
    const { findByRole } = render(GraphView);
    const legend = await findByRole("list", { name: "Legend" });
    const items = within(legend).getAllByRole("listitem").map((li) => li.textContent?.trim());
    expect(items).toEqual(["tag written in the note", "tag added", "Space", "suggested Space"]);
  });

  it("offers the lens only when a note is open, with Show all as the escape", async () => {
    const { findByRole, queryByRole } = render(GraphView);
    await findByRole("button", { name: "Note: Alpha" });
    expect(queryByRole("button", { name: "Show all" })).toBeNull();
    cleanup();
    lib.selected = { id: "n1" };
    const view = render(GraphView);
    const toggle = await view.findByRole("button", { name: "Show all" });
    await fireEvent.click(toggle);
    expect(view.getByRole("button", { name: "Around this note" })).toBeTruthy();
  });
});

describe("GraphView suggestions", () => {
  beforeEach(() => {
    vi.mocked(spaceSuggestions).mockResolvedValue([SUGGESTION]);
  });

  it("lists each suggestion with its note, Space, confidence, and reasons", async () => {
    const { findByRole } = render(GraphView);
    const panel = await findByRole("complementary", { name: "Filing suggestions" });
    const row = within(panel).getByRole("listitem");
    expect(within(row).getByRole("button", { name: "Lasagne" })).toBeTruthy();
    expect(row.textContent).toMatch(/Research/);
    expect(row.textContent).toMatch(/84%/);
    expect(row.textContent).toMatch(/because #pasta, simmer, ragu/);
    expect(within(row).getByRole("button", { name: "Add “Lasagne” to Research" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Don't suggest Research for “Lasagne”" })).toBeTruthy();
  });

  it("draws the suggested note, named for what it is suggested for", async () => {
    const { findByRole } = render(GraphView);
    expect(await findByRole("button", { name: "Note: Lasagne, suggested for Research" })).toBeTruthy();
  });

  it("files the note on accept and offers to undo it", async () => {
    const { findByRole, queryByRole } = render(GraphView);
    await fireEvent.click(await findByRole("button", { name: "Add “Lasagne” to Research" }));
    await waitFor(() => expect(addNoteToWorkspace).toHaveBeenCalledWith("n4", "s1"));
    expect(queryByRole("complementary", { name: "Filing suggestions" })).toBeNull();
    await waitFor(() => expect(show).toHaveBeenCalled());
    const [message, action] = show.mock.calls[0];
    expect(message).toBe('Filed "Lasagne" in Research');
    action?.run();
    expect(removeNoteFromWorkspace).toHaveBeenCalledWith("n4", "s1");
  });

  it("remembers a dismissal, changes nothing else, and can take it back", async () => {
    const { findByRole, queryByRole } = render(GraphView);
    await fireEvent.click(await findByRole("button", { name: "Don't suggest Research for “Lasagne”" }));
    await waitFor(() => expect(dismissSpaceSuggestion).toHaveBeenCalledWith("n4", "s1"));
    expect(addNoteToWorkspace).not.toHaveBeenCalled();
    expect(queryByRole("complementary", { name: "Filing suggestions" })).toBeNull();
    expect(lib.refreshSuggestionCount).toHaveBeenCalled();
    await waitFor(() => expect(show).toHaveBeenCalled());
    const [message, action] = show.mock.calls[0];
    expect(message).toBe('Won\'t suggest Research for "Lasagne"');
    action?.run();
    expect(restoreSpaceSuggestion).toHaveBeenCalledWith("n4", "s1");
    await waitFor(() => expect(spaceSuggestions).toHaveBeenCalledTimes(2));
  });

  it("opens the note from its row", async () => {
    const { findByRole } = render(GraphView);
    const panel = await findByRole("complementary", { name: "Filing suggestions" });
    await fireEvent.click(within(panel).getByRole("button", { name: "Lasagne" }));
    expect(lib.select).toHaveBeenCalledWith("n4");
  });

  it("shows two hundred suggestions a page at a time", async () => {
    const notes = Array.from({ length: 200 }, (_, i) => note(`u${i}`, `Unfiled ${i}`));
    vi.mocked(libraryGraph).mockResolvedValue({ ...GRAPH, notes: [...GRAPH.notes, ...notes] });
    vi.mocked(spaceSuggestions).mockResolvedValue(
      notes.map((n) => ({ ...SUGGESTION, noteId: n.id, noteTitle: n.title })),
    );
    const { findByRole, getByRole, getAllByRole } = render(GraphView);
    const panel = await findByRole("complementary", { name: "Filing suggestions" });
    expect(panel.textContent).toMatch(/Where these belong\s*200/);
    expect(within(panel).getAllByRole("listitem")).toHaveLength(25);
    expect(getAllByRole("button", { name: /suggested for Research/ })).toHaveLength(25);
    await fireEvent.click(getByRole("button", { name: "Show 25 more" }));
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(50));
  });

  it("still draws the graph when suggestions cannot load", async () => {
    vi.mocked(spaceSuggestions).mockRejectedValue(new Error("no"));
    const { findByRole, queryByRole } = render(GraphView);
    expect(await findByRole("button", { name: "Note: Alpha" })).toBeTruthy();
    expect(queryByRole("complementary", { name: "Filing suggestions" })).toBeNull();
  });
});
