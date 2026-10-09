// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { clockTime, type AgentActivity } from "$lib/agent-activity";

const { select, selectWorkspace, setBlocked, show, overrides, blocked, ask, endAgentSession } = vi.hoisted(() => ({
  ask: vi.fn(),
  endAgentSession: vi.fn(),
  select: vi.fn(),
  selectWorkspace: vi.fn(),
  setBlocked: vi.fn(),
  show: vi.fn(),
  overrides: { value: {} as Record<string, unknown> },
  blocked: { value: false },
}));

function entry(seq: number, noteIds: string[]): AgentActivity {
  return {
    seq,
    at: 1_700_000_000_000 + seq,
    session: "s1",
    client: "claude-code",
    tool: "get_note",
    kind: "read",
    status: "ok",
    error: null,
    durationMs: 12,
    noteIds,
    noteCount: noteIds.length,
    titles: noteIds.map((id) => `Note ${id}`),
    space: null,
    tag: null,
    query: null,
    afterUpdatedAt: null,
    revertable: false,
    revertedAt: null,
    reverts: null,
  };
}

const entries = [entry(2, ["n1", "n2"]), entry(1, ["n1"])];

vi.mock("$lib/stores/library.svelte", () => ({
  library: { selected: { id: "agent-session:s1" }, notes: [], select, selectWorkspace },
}));
vi.mock("$lib/stores/agents-space", () => ({
  agentsSpace: {
    sessionFor: () => ({
      session: "s1",
      client: "claude-code",
      startedAt: 1,
      endedAt: 2,
      entries,
      reads: 2,
      writes: 0,
      errors: 0,
      connected: true,
      clocks: [{ session: "s1", inAt: 1, outAt: null }],
      label: null,
      clientSession: null,
      cwd: null,
      inferred: false,
      ...overrides.value,
    }),
  },
}));
vi.mock("$lib/stores/agents.svelte", () => ({
  agents: {
    access: "read",
    hasMore: false,
    doing: () => null,
    isBlocked: () => blocked.value,
    setBlocked,
    revert: vi.fn(),
    loadMore: vi.fn(),
    clear: vi.fn(),
  },
}));
vi.mock("$lib/stores/toasts.svelte", () => ({ toasts: { show } }));
vi.mock("$lib/stores/confirm.svelte", () => ({ confirmDialog: { ask } }));
vi.mock("$lib/api/client", () => ({
  agentActivityBefore: vi.fn().mockResolvedValue(null),
  agentActivityWire: vi.fn().mockResolvedValue(null),
  endAgentSession,
}));

import AgentNote from "./AgentNote.svelte";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  overrides.value = {};
  blocked.value = false;
});

describe("AgentNote", () => {
  it("opens the note a row touched from the row itself, without unfolding it", async () => {
    const { getByRole, queryByText } = render(AgentNote);
    await fireEvent.click(getByRole("button", { name: "Open note" }));
    expect(selectWorkspace).toHaveBeenCalledWith(null);
    expect(select).toHaveBeenCalledWith("n1");
    expect(queryByText("Loading…")).toBeNull();
  });

  it("offers no Open note on a row that touched several notes", () => {
    const { getAllByRole } = render(AgentNote);
    expect(getAllByRole("button", { name: "Open note" })).toHaveLength(1);
  });

  it("blocks the agent's kind from its own page", async () => {
    const { getByRole } = render(AgentNote);
    await fireEvent.click(getByRole("button", { name: "Block Claude Code" }));
    expect(setBlocked).toHaveBeenCalledWith("claude-code", true);
    expect(show).toHaveBeenCalledWith(expect.stringContaining("is blocked"));
  });

  it("offers to unblock a kind that is already blocked", async () => {
    blocked.value = true;
    const { getByRole } = render(AgentNote);
    await fireEvent.click(getByRole("button", { name: "Unblock Claude Code" }));
    expect(setBlocked).toHaveBeenCalledWith("claude-code", false);
  });

  it("shows a connected agent's clock-in as a punch card with no words", () => {
    const { getByRole, getByText, queryByText } = render(AgentNote);
    expect(getByRole("img", { name: /^In / })).toBeTruthy();
    expect(getByText(clockTime(1))).toBeTruthy();
    expect(queryByText(/Connected/)).toBeNull();
    expect(queryByText(/since/)).toBeNull();
  });

  it("punches the clock-out too once the agent has gone offline", () => {
    overrides.value = { connected: false, clocks: [{ session: "s1", inAt: 1000, outAt: 61_000 }] };
    const { getByRole, getByText } = render(AgentNote);
    expect(getByRole("img", { name: /^In / }).getAttribute("aria-label")?.match(/(In|Out) /g)).toEqual(["In ", "Out "]);
    expect(getByText(clockTime(1000))).toBeTruthy();
    expect(getByText(clockTime(61_000))).toBeTruthy();
  });

  it("punches every time a returning session clocked back in", () => {
    overrides.value = {
      clocks: [
        { session: "s0", inAt: 1000, outAt: 61_000 },
        { session: "s1", inAt: 3_600_000, outAt: null },
      ],
    };
    const { getByRole, getByText } = render(AgentNote);
    expect(getByRole("img", { name: /^In / }).getAttribute("aria-label")?.match(/(In|Out) /g)).toEqual(["In ", "Out ", "In "]);
    expect(getByText(clockTime(3_600_000))).toBeTruthy();
  });

  it("ends a connected session only once the user confirms", async () => {
    ask.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { getByRole } = render(AgentNote);
    const end = getByRole("button", { name: "End session" });
    await fireEvent.click(end);
    expect(endAgentSession).not.toHaveBeenCalled();
    await fireEvent.click(end);
    await vi.waitFor(() => expect(endAgentSession).toHaveBeenCalledWith("s1"));
  });

  it("has no session to end once the agent is gone", () => {
    overrides.value = { connected: false };
    const { queryByRole } = render(AgentNote);
    expect(queryByRole("button", { name: "End session" })).toBeNull();
  });
});
