import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  getAgentConnection: vi.fn(async () => null),
}));

import { agents, PRESENCE_MS } from "./agents.svelte";
import type { AgentActivity } from "$lib/agent-activity";

const entry = (over: Partial<AgentActivity>): AgentActivity => ({
  at: 1,
  client: "claude-code",
  tool: "get_note",
  kind: "read",
  noteIds: [],
  noteCount: 0,
  titles: [],
  space: null,
  tag: null,
  query: null,
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
});
