import { describe, it, expect } from "vitest";
import type { AgentActivity, AgentPresence, AgentSession } from "$lib/agent-activity";
import {
  AGENTS_SPACE_ID,
  agentNoteId,
  buildAgentNotes,
  joinConversations,
  isAgentNoteId,
  isAgentsSpaceId,
  sessionOfNote,
  sessionSummary,
} from "./space";
import { isSyntheticNoteId, isSyntheticSpaceId } from "$lib/synthetic";
import { UPDATE_NOTE_ID, UPDATE_SPACE_ID } from "$lib/update/space";

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  session: "s1",
  client: "claude-code",
  startedAt: Date.UTC(2026, 9, 1, 10, 0),
  endedAt: Date.UTC(2026, 9, 1, 10, 5),
  entries: [],
  reads: 5,
  writes: 3,
  errors: 1,
  ...over,
});

describe("the Agents Space", () => {
  it("knows its own ids and no one else's", () => {
    expect(isAgentsSpaceId(AGENTS_SPACE_ID)).toBe(true);
    expect(isAgentsSpaceId("ws-1")).toBe(false);
    expect(isAgentsSpaceId(null)).toBe(false);
    expect(isAgentNoteId(agentNoteId("s1"))).toBe(true);
    expect(isAgentNoteId("n1")).toBe(false);
    expect(sessionOfNote(agentNoteId("s1"))).toBe("s1");
    expect(sessionOfNote("n1")).toBeNull();
  });

  it("counts as synthetic alongside the update Space", () => {
    expect(isSyntheticSpaceId(AGENTS_SPACE_ID)).toBe(true);
    expect(isSyntheticSpaceId(UPDATE_SPACE_ID)).toBe(true);
    expect(isSyntheticSpaceId("ws-1")).toBe(false);
    expect(isSyntheticNoteId(agentNoteId("s1"))).toBe(true);
    expect(isSyntheticNoteId(UPDATE_NOTE_ID)).toBe(true);
    expect(isSyntheticNoteId("n1")).toBe(false);
  });

  it("sums a conversation up, leaving out what did not happen", () => {
    expect(sessionSummary(session())).toBe("3 changes · 5 reads · 1 failed");
    expect(sessionSummary(session({ writes: 1, reads: 0, errors: 0 }))).toBe("1 change");
  });

  it("draws one note per conversation, dated by its last call", () => {
    const [note] = buildAgentNotes(joinConversations([session()], []));
    expect(note.id).toBe(agentNoteId("s1"));
    expect(note.title).toBe("Claude Code");
    expect(note.body).toBe("3 changes · 5 reads · 1 failed");
    expect(note.updatedAt).toBe("2026-10-01T10:05:00.000Z");
    expect(note.createdAt).toBe("2026-10-01T10:00:00.000Z");
  });

  const presence = (over: Partial<AgentPresence> = {}): AgentPresence => ({
    session: "s1",
    client: "claude-code",
    connectedAt: Date.UTC(2026, 9, 1, 9, 59),
    disconnectedAt: null,
    connected: true,
    ...over,
  });

  it("puts connected agents first, the silent ones included", () => {
    const convs = joinConversations(
      [session({ session: "old", endedAt: Date.UTC(2026, 9, 1, 12, 0) }), session()],
      [presence(), presence({ session: "quiet", client: "hermes" })],
    );
    expect(convs.map((c) => [c.session, c.connected])).toEqual([
      ["s1", true],
      ["quiet", true],
      ["old", false],
    ]);
    // An ended connection that never asked for anything is not a conversation.
    const none = joinConversations(
      [],
      [presence({ connected: false, disconnectedAt: 5 })],
    );
    expect(none).toEqual([]);
  });

  it("says what an agent is doing right now, then settles to the summary", () => {
    const convs = joinConversations([session()], [presence(), presence({ session: "quiet" })]);
    const doing = { tool: "get_note", status: "ok", titles: ["Roadmap"], noteCount: 1 } as AgentActivity;
    const live = buildAgentNotes(convs, (s) => (s === "s1" ? doing : null));
    expect(live[0].body).toBe("Reading “Roadmap”");
    expect(live[1].body).toBe("Connected. Nothing asked yet.");
    expect(buildAgentNotes(convs)[0].body).toBe("3 changes · 5 reads · 1 failed");
  });

  it("names a conversation by its client and the session's own name", () => {
    const named = joinConversations(
      [session()],
      [presence({ label: "bob", clientSession: "ec23c3e6", cwd: "/work" })],
    );
    expect(buildAgentNotes(named)[0].title).toBe("Claude Code: bob");
    expect(named[0].clientSession).toBe("ec23c3e6");
    // A client that names nothing is just itself.
    expect(buildAgentNotes(joinConversations([session()], [presence()]))[0].title).toBe("Claude Code");
  });
});
