import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("$lib/api/client", () => ({
  ApiError: class extends Error {},
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  getAgentConnection: vi.fn(async () => null),
  listAgentActivity: vi.fn(async () => []),
  revertAgentActivity: vi.fn(),
  clearAgentActivity: vi.fn(async () => {}),
}));

import { revertAgentActivity } from "$lib/api/client";
import { toasts } from "$lib/stores/toasts.svelte";
import { agents, PRESENCE_MS } from "./agents.svelte";
import type { AgentActivity } from "$lib/agent-activity";

let seq = 0;
const entry = (over: Partial<AgentActivity>): AgentActivity => ({
  seq: ++seq,
  at: 1,
  session: "s1",
  client: "claude-code",
  tool: "get_note",
  kind: "read",
  status: "ok",
  error: null,
  durationMs: 1,
  noteIds: [],
  noteCount: 0,
  titles: [],
  space: null,
  tag: null,
  query: null,
  afterUpdatedAt: null,
  revertable: false,
  revertedAt: null,
  reverts: null,
  ...over,
});

describe("agents presence", () => {
  it("lights what a call touched, then lets it fade", () => {
    const t0 = 1_000_000;
    agents.play(
      [
        entry({ tool: "list_notes", space: "Ideas", noteIds: ["a", "b"] }),
        entry({ tool: "append_to_note", kind: "write", noteIds: ["b"], tag: "#Plan" }),
      ],
      t0,
    );
    expect(agents.noteMark("a")).toBe("read");
    expect(agents.noteMark("b")).toBe("write");
    expect(agents.spaceActive("ideas")).toBe(true);
    expect(agents.tagActive("plan")).toBe(true);
    expect(agents.current?.tool).toBe("append_to_note");
    expect(agents.recent[0].tool).toBe("append_to_note");
    expect(agents.lastWriter("b")).toBe("claude-code");

    // A later call on "a" keeps it lit past the first call's time.
    agents.play([entry({ noteIds: ["a"] })], t0 + PRESENCE_MS - 1);
    agents.expire(t0 + PRESENCE_MS);
    expect(agents.noteMark("a")).toBe("read");
    expect(agents.noteMark("b")).toBeNull();
    expect(agents.spaceActive("Ideas")).toBe(false);

    agents.expire(t0 + 2 * PRESENCE_MS);
    expect(agents.noteMark("a")).toBeNull();
    expect(agents.current).toBeNull();
  });

  it("ignores an empty batch", () => {
    const before = agents.recent.length;
    agents.play([]);
    expect(agents.recent.length).toBe(before);
  });

  it("shows an agent's search where the user searches, then lets it fade", () => {
    const t0 = 5_000_000;
    agents.play([entry({ tool: "search_notes", kind: "search", query: "sync", noteIds: ["x"] })], t0);
    expect(agents.currentSearch?.query).toBe("sync");
    expect(agents.noteMark("x")).toBe("search");
    agents.expire(t0 + PRESENCE_MS);
    expect(agents.currentSearch).toBeNull();
  });

  it("toasts a change with Revert on it, and counts it as unseen", () => {
    toasts.items = [];
    agents.unseen = 0;
    const write = entry({ tool: "update_note", kind: "write", noteIds: ["n"], titles: ["Plan"], revertable: true });
    agents.play([entry({ tool: "list_notes" }), write]);
    expect(toasts.items).toHaveLength(1);
    expect(toasts.items[0].message).toBe("Claude Code: Editing “Plan”");
    expect(toasts.items[0].action?.label).toBe("Revert");
    expect(agents.unseen).toBe(1);
    agents.openPanel();
    expect(agents.unseen).toBe(0);
    expect(agents.revertableFor("n").map((e) => e.seq)).toEqual([write.seq]);
  });

  it("stays quiet when notifications are off, and tells everything when asked", () => {
    toasts.items = [];
    agents.setNotify("off");
    agents.play([entry({ tool: "update_note", kind: "write", revertable: true })]);
    expect(toasts.items).toHaveLength(0);
    agents.setNotify("all");
    agents.play([entry({ tool: "list_tags" })]);
    expect(toasts.items).toHaveLength(1);
    agents.setNotify("writes");
  });

  it("reverting marks the row and offers to undo the revert", async () => {
    toasts.items = [];
    const write = entry({ tool: "append_to_note", kind: "write", noteIds: ["n"], titles: ["Plan"], revertable: true });
    agents.play([write]);
    const revertRow = entry({
      tool: "revert", client: "instantnotes", kind: "write", at: 99,
      noteIds: ["n"], titles: ["Plan"], revertable: true, reverts: write.seq,
    });
    vi.mocked(revertAgentActivity).mockResolvedValueOnce(revertRow);
    expect(await agents.revert(write.seq)).toBe(true);
    expect(agents.recent.find((e) => e.seq === write.seq)?.revertedAt).toBe(99);
    const toast = toasts.items.at(-1)!;
    expect(toast.message).toBe("Reverted. Reverted a change to “Plan”");
    expect(toast.action?.label).toBe("Undo");
    // The shell echoes the revert as an external change: folded in once,
    // and the row it undid stays marked. No toast for the app's own row.
    const before = toasts.items.length;
    agents.play([revertRow]);
    expect(agents.recent.filter((e) => e.seq === revertRow.seq)).toHaveLength(1);
    expect(toasts.items.length).toBe(before);
    expect(agents.lastWriter("n")).toBe("instantnotes");
  });

  it("says so when a revert fails", async () => {
    toasts.items = [];
    vi.mocked(revertAgentActivity).mockRejectedValueOnce(new Error("nope"));
    expect(await agents.revert(12345)).toBe(false);
    expect(toasts.items.at(-1)?.message).toMatch(/^Couldn't revert/);
  });
});
