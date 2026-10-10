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
      [presence({ label: "bob", clientSession: "ec23c3e6", cwd: "/work", matched: "exact" })],
    );
    expect(named[0].inferred).toBe(false);
    const matched = joinConversations(
      [session()],
      [presence({ client: "hermes", label: "Fix the build", matched: "inferred" })],
    );
    expect(buildAgentNotes(matched)[0].title).toBe("Hermes: Fix the build");
    expect(matched[0].inferred).toBe(true);
    expect(buildAgentNotes(named)[0].title).toBe("Claude Code: bob");
    expect(named[0].clientSession).toBe("ec23c3e6");
    expect(buildAgentNotes(joinConversations([session()], [presence()]))[0].title).toBe("Claude Code");
  });

  it("keeps a client session that clocks back in as one conversation", () => {
    const entry = (seq: number, at: number) => ({ seq, at }) as AgentActivity;
    const convs = joinConversations(
      [
        session({ session: "first", startedAt: 1500, endedAt: 2000, entries: [entry(1, 1500)] }),
        session({ session: "again", startedAt: 5000, endedAt: 6000, entries: [entry(2, 5500)] }),
        session({ session: "other", endedAt: 3000 }),
      ],
      [
        presence({ session: "first", clientSession: "c1", connectedAt: 1000, connected: false, disconnectedAt: 2500 }),
        presence({ session: "again", clientSession: "c1", connectedAt: 4000 }),
        presence({ session: "other", clientSession: "c2", connectedAt: 900, connected: false, disconnectedAt: 3000 }),
      ],
    );
    expect(convs.map((c) => c.session)).toEqual(["again", "other"]);
    const [back] = convs;
    expect(back.connected).toBe(true);
    expect(back.clocks).toEqual([
      { session: "first", inAt: 1000, outAt: 2500 },
      { session: "again", inAt: 4000, outAt: null },
    ]);
    expect(back.entries.map((e) => e.seq)).toEqual([2, 1]);
    expect([back.reads, back.writes, back.errors]).toEqual([10, 6, 2]);
    expect(back.startedAt).toBe(1500);
    expect(back.endedAt).toBe(6000);
    expect(buildAgentNotes(convs)[0].id).toBe(agentNoteId("first"));
  });
});
