import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getNote,
  listNotes,
  listTags,
  listWorkspaces,
  tagsForNote,
  updateNote,
  workspacesForNote,
} from "$lib/api/client";
import { listen } from "@tauri-apps/api/event";
import { EVENTS } from "$lib/api/events";
import type { Note } from "$lib/api/types";
import type { AgentActivity } from "$lib/agent-activity";

vi.mock("$lib/api/client", () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ApiError,
    getNote: vi.fn(),
    updateNote: vi.fn(),
    listNotes: vi.fn(),
    listTags: vi.fn(),
    listWorkspaces: vi.fn(),
    tagsForNote: vi.fn(),
    workspacesForNote: vi.fn(),
    listWorkspaceTags: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    getAgentConnection: vi.fn(),
    listAgentActivity: vi.fn(async () => []),
    revertAgentActivity: vi.fn(),
    clearAgentActivity: vi.fn(),
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({ convertToExcalidrawElements: vi.fn() }));

const mockGetNote = vi.mocked(getNote);
const mockUpdateNote = vi.mocked(updateNote);
const mockListen = vi.mocked(listen);

const T0 = "2026-01-01T00:00:00.000000Z";
const T1 = "2026-01-01T00:05:00.000000Z";
const T2 = "2026-01-01T00:06:00.000000Z";

const mkNote = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: "Plan",
  body: "Plan",
  createdAt: T0,
  updatedAt: T0,
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  contentKind: "document",
  ...over,
});

let seq = 0;
const write = (noteId: string): AgentActivity => ({
  seq: ++seq,
  at: 1,
  session: "s1",
  client: "claude-code",
  tool: "append_to_note",
  kind: "write",
  status: "ok",
  error: null,
  durationMs: 1,
  noteIds: [noteId],
  noteCount: 1,
  titles: ["Plan"],
  space: null,
  tag: null,
  query: null,
  afterUpdatedAt: null,
  revertable: true,
  revertedAt: null,
  reverts: null,
});

async function setup() {
  const { library } = await import("$lib/stores/library.svelte");
  const { toasts } = await import("$lib/stores/toasts.svelte");
  const { agents } = await import("$lib/stores/agents.svelte");
  await library.init();
  const call = mockListen.mock.calls.find(([name]) => name === EVENTS.LIBRARY_EXTERNAL_CHANGE);
  const external = call![1] as (e: { payload: unknown }) => void;
  mockGetNote.mockResolvedValueOnce(mkNote("n1"));
  await library.select("n1");
  return { library, toasts, agents, external };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockGetNote.mockReset();
  mockUpdateNote.mockReset();
  vi.mocked(listNotes).mockReset().mockResolvedValue([]);
  vi.mocked(listTags).mockReset().mockResolvedValue([]);
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([]);
  vi.mocked(tagsForNote).mockReset().mockResolvedValue([]);
  vi.mocked(workspacesForNote).mockReset().mockResolvedValue([]);
  mockListen.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an agent writes to the open note", () => {
  it("with nothing unsaved, the note takes the agent's version", async () => {
    const { library, external } = await setup();
    mockGetNote.mockResolvedValueOnce(mkNote("n1", { body: "Plan\n- agent step", updatedAt: T1 }));

    external({ payload: [write("n1")] });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetNote).toHaveBeenLastCalledWith("n1", false);
    expect(library.selected?.body).toBe("Plan\n- agent step");

    mockUpdateNote.mockResolvedValueOnce(mkNote("n1", { body: "Plan\n- agent step!", updatedAt: T2 }));
    library.editBody("Plan\n- agent step!");
    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenCalledWith("n1", {
      body: "Plan\n- agent step!",
      expectedUpdatedAt: T1,
    });
  });

  it("leaves a note alone while the user has unsaved typing", async () => {
    const { library, external } = await setup();
    library.editBody("Plan, mid-sentence");
    mockGetNote.mockClear();

    external({ payload: [write("n1")] });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetNote).not.toHaveBeenCalled();
    expect(library.selected?.body).toBe("Plan, mid-sentence");
  });

  it("ignores a write to some other note", async () => {
    const { library, external } = await setup();
    mockGetNote.mockClear();
    external({ payload: [write("n2"), { ...write("n1"), kind: "read" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetNote).not.toHaveBeenCalled();
    expect(library.selected?.body).toBe("Plan");
  });
});

describe("an agent appends rows to the open sheet", () => {
  const grid = (rows: string[][]) =>
    JSON.stringify({ v: 1, engine: "grid", data: { cols: rows[0].map(() => ({ w: 120 })), rows } });
  const rowsOf = (raw: string | null | undefined) => JSON.parse(raw ?? "").data.rows as string[][];
  const BASE = grid([["Date", "ms"], ["d1", "1"], ["", ""]]);
  const THEIRS = grid([["Date", "ms"], ["d1", "1"], ["a1", "9"]]);

  async function openSheet() {
    const { library } = await import("$lib/stores/library.svelte");
    await library.init();
    const call = mockListen.mock.calls.find(([name]) => name === EVENTS.LIBRARY_EXTERNAL_CHANGE);
    const external = call![1] as (e: { payload: unknown }) => void;
    mockGetNote.mockResolvedValueOnce(mkNote("s1", { contentKind: "sheet", surfaceData: BASE }));
    await library.select("s1");
    return { library, external };
  }

  it("with nothing unsaved, the grid takes the agent's version whole", async () => {
    const { library, external } = await openSheet();
    mockGetNote.mockResolvedValueOnce(
      mkNote("s1", { contentKind: "sheet", surfaceData: THEIRS, body: "table", updatedAt: T1 }),
    );
    external({ payload: [{ ...write("s1"), tool: "append_sheet_rows" }] });
    await vi.advanceTimersByTimeAsync(0);

    expect(library.selected?.surfaceData).toBe(THEIRS);
    expect(library.selected?.body).toBe("table");
    mockUpdateNote.mockResolvedValueOnce(mkNote("s1", { contentKind: "sheet", updatedAt: T2 }));
    library.editSheet("s1", grid([["Date", "ms"], ["d1", "1"], ["a1", "9"], ["d2", "2"]]));
    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote.mock.calls[0][1].expectedUpdatedAt).toBe(T1);
  });

  it("with unsaved cells, the agent's rows join the grid and the waiting save", async () => {
    const { library, external } = await openSheet();
    const mine = grid([["Date", "ms"], ["d1", "11"], ["d2", "2"]]);
    library.editSheet("s1", mine);
    mockGetNote.mockResolvedValueOnce(
      mkNote("s1", { contentKind: "sheet", surfaceData: THEIRS, updatedAt: T1 }),
    );
    mockUpdateNote.mockResolvedValueOnce(mkNote("s1", { contentKind: "sheet", updatedAt: T2 }));

    external({ payload: [{ ...write("s1"), tool: "append_sheet_rows" }] });
    await vi.advanceTimersByTimeAsync(0);

    const shown = rowsOf(library.selected?.surfaceData);
    expect(shown).toEqual([["Date", "ms"], ["d1", "11"], ["d2", "2"], ["a1", "9"]]);
    await vi.advanceTimersByTimeAsync(400);
    const [, patch] = mockUpdateNote.mock.calls[0];
    expect(rowsOf(patch.surfaceData)).toEqual(shown);
    expect(patch.expectedUpdatedAt).toBe(T1);
  });

  it("a save that meets the agent's append carries its rows instead of losing them", async () => {
    const { library } = await openSheet();
    const mine = grid([["Date", "ms"], ["d1", "11"], ["", ""]]);
    mockUpdateNote
      .mockRejectedValueOnce(new ApiError("CONFLICT" as never, "changed"))
      .mockResolvedValueOnce(mkNote("s1", { contentKind: "sheet", updatedAt: T2 }));
    mockGetNote.mockResolvedValueOnce(
      mkNote("s1", { contentKind: "sheet", surfaceData: THEIRS, updatedAt: T1 }),
    );

    library.editSheet("s1", mine);
    await vi.advanceTimersByTimeAsync(400);

    expect(mockUpdateNote).toHaveBeenCalledTimes(2);
    const [, retry] = mockUpdateNote.mock.calls[1];
    expect(retry.expectedUpdatedAt).toBe(T1);
    expect(rowsOf(retry.surfaceData)).toEqual([["Date", "ms"], ["d1", "11"], ["a1", "9"]]);
    expect(rowsOf(library.selected?.surfaceData)).toEqual([["Date", "ms"], ["d1", "11"], ["a1", "9"]]);
    expect(library.saveState).toBe("saved");
  });
});

describe("a save meets an agent's edit", () => {
  it("keeps the user's typing, names the agent, and offers theirs back", async () => {
    const { library, toasts, agents } = await setup();
    agents.play([write("n1")]);
    const theirs = "Plan\n- agent step";
    mockUpdateNote
      .mockRejectedValueOnce(new ApiError("CONFLICT" as never, "changed"))
      .mockResolvedValueOnce(mkNote("n1", { body: "Plan, mine", updatedAt: T2 }));
    mockGetNote.mockResolvedValueOnce(mkNote("n1", { body: theirs, updatedAt: T1 }));

    library.editBody("Plan, mine");
    await vi.advanceTimersByTimeAsync(400);

    expect(mockUpdateNote).toHaveBeenLastCalledWith("n1", {
      body: "Plan, mine",
      expectedUpdatedAt: T1,
    });
    expect(library.saveState).toBe("saved");
    const toast = toasts.items.at(-1)!;
    expect(toast.message).toBe("Claude Code's change to this note was replaced by your typing.");
    expect(toast.action?.label).toBe("Restore theirs");

    mockUpdateNote.mockResolvedValueOnce(mkNote("n1", { body: theirs, updatedAt: "2026-01-01T00:07:00.000000Z" }));
    toast.action!.run();
    expect(library.selected?.body).toBe(theirs);
    await vi.advanceTimersByTimeAsync(400);
    expect(mockUpdateNote).toHaveBeenLastCalledWith("n1", { body: theirs, expectedUpdatedAt: T2 });
  });

  it("says nothing when only the note's details changed, not its text", async () => {
    const { library, toasts } = await setup();
    mockUpdateNote
      .mockRejectedValueOnce(new ApiError("CONFLICT" as never, "changed"))
      .mockResolvedValueOnce(mkNote("n1", { body: "Plan, mine", updatedAt: T2 }));
    mockGetNote.mockResolvedValueOnce(mkNote("n1", { isPinned: true, updatedAt: T1 }));

    library.editBody("Plan, mine");
    await vi.advanceTimersByTimeAsync(400);

    expect(mockUpdateNote).toHaveBeenCalledTimes(2);
    expect(toasts.items).toHaveLength(0);
  });
});

describe("another window adds to the open note", () => {
  it("takes the new text in place, so the next edit builds on it", async () => {
    const { library } = await setup();
    const changed = mockListen.mock.calls.find(([name]) => name === EVENTS.NOTES_CHANGED)![1] as () => void;
    const appended = mkNote("n1", { body: "Plan\n\nfrom the capture panel", updatedAt: T1 });
    vi.mocked(listNotes).mockResolvedValue([appended]);
    mockGetNote.mockResolvedValueOnce(appended);

    changed();
    await vi.advanceTimersByTimeAsync(100);

    expect(library.selected?.body).toBe("Plan\n\nfrom the capture panel");
    mockUpdateNote.mockResolvedValueOnce(mkNote("n1", { body: `${appended.body}!`, updatedAt: T2 }));
    library.editBody(`${appended.body}!`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockUpdateNote).toHaveBeenLastCalledWith("n1", { body: `${appended.body}!`, expectedUpdatedAt: T1 });
  });
});
