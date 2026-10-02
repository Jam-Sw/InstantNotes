// The synthetic Space that holds the agent trace: one note per agent
// conversation, newest first. Like the update Space, nothing here is stored:
// the Space and its notes are derived from the trace and rendered through the
// ordinary sidebar and note rows, so they cannot be searched, tagged, or
// synced. Pure, so it stays unit-testable without runes.

import type { Note } from "$lib/api/types";
import { clientLabel, type AgentSession } from "$lib/agent-activity";

/** Sentinel ids no real workspace or note can hold (ids are UUIDs). */
export const AGENTS_SPACE_ID = "agents-space";
export const AGENTS_SPACE_NAME = "Agents";
const NOTE_PREFIX = "agent-session:";

export function isAgentsSpaceId(id: string | null | undefined): boolean {
  return id === AGENTS_SPACE_ID;
}

export function isAgentNoteId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(NOTE_PREFIX);
}

export function agentNoteId(session: string): string {
  return NOTE_PREFIX + session;
}

/** The session a synthetic note stands for, or null for any other note. */
export function sessionOfNote(id: string | null | undefined): string | null {
  return id && isAgentNoteId(id) ? id.slice(NOTE_PREFIX.length) : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 changes · 5 reads · 1 failed": what the session did, for its list row. */
export function sessionSummary(s: AgentSession): string {
  const parts: string[] = [];
  if (s.writes) parts.push(plural(s.writes, "change", "changes"));
  if (s.reads) parts.push(plural(s.reads, "read", "reads"));
  if (s.errors) parts.push(`${s.errors} failed`);
  return parts.join(" · ");
}

export function buildAgentNotes(sessions: AgentSession[]): Note[] {
  return sessions.map((s) => ({
    id: agentNoteId(s.session),
    title: clientLabel(s.client),
    // Only the list row ever shows this; opening the note renders the trace.
    body: sessionSummary(s),
    createdAt: new Date(s.startedAt).toISOString(),
    updatedAt: new Date(s.endedAt).toISOString(),
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document" as const,
  }));
}
