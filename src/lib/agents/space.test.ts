import { describe, it, expect } from "vitest";
import type { AgentSession } from "$lib/agent-activity";
import {
  AGENTS_SPACE_ID,
  agentNoteId,
  buildAgentNotes,
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
    const [note] = buildAgentNotes([session()]);
    expect(note.id).toBe(agentNoteId("s1"));
    expect(note.title).toBe("Claude Code");
    expect(note.body).toBe("3 changes · 5 reads · 1 failed");
    expect(note.updatedAt).toBe("2026-10-01T10:05:00.000Z");
    expect(note.createdAt).toBe("2026-10-01T10:00:00.000Z");
  });
});
