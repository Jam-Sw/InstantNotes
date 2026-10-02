// The synthetic Space that holds the agent trace: one note per agent
// conversation, newest first. Like the update Space, nothing here is stored:
// the Space and its notes are derived from the trace and rendered through the
// ordinary sidebar and note rows, so they cannot be searched, tagged, or
// synced. Pure, so it stays unit-testable without runes.

import type { Note } from "$lib/api/types";
import {
  agentName,
  describeActivity,
  type AgentActivity,
  type AgentPresence,
  type AgentSession,
} from "$lib/agent-activity";

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

/** A conversation: what an agent did (the trace) joined with whether it is
 *  still connected (its process). `connectedAt` is null for a conversation
 *  traced before connections were kept. */
export interface AgentConversation extends AgentSession {
  connected: boolean;
  connectedAt: number | null;
  disconnectedAt: number | null;
  /** The client's name for its session, its id for it, and where it runs,
   *  for a client that says (Claude Code does). */
  label: string | null;
  clientSession: string | null;
  cwd: string | null;
  /** True when the session was matched from the outside, not stated. */
  inferred: boolean;
}

/** Join the trace's sessions with the connections. A connected agent that
 *  has asked for nothing yet still gets a conversation; an ended one that
 *  never asked for anything does not. Connected first, then most recent. */
export function joinConversations(
  sessions: AgentSession[],
  presence: AgentPresence[],
): AgentConversation[] {
  const known = new Map(presence.map((p) => [p.session, p]));
  const out: AgentConversation[] = sessions.map((s) => {
    const p = known.get(s.session);
    return {
      ...s,
      // The connection knows its client best: it has the handshake and the
      // process that started the server, where a trace row has only what
      // was known when the call was made.
      client: p?.client ?? s.client,
      connected: p?.connected ?? false,
      connectedAt: p?.connectedAt ?? null,
      disconnectedAt: p?.disconnectedAt ?? null,
      label: p?.label ?? null,
      clientSession: p?.clientSession ?? null,
      cwd: p?.cwd ?? null,
      inferred: p?.matched === "inferred",
    };
  });
  const traced = new Set(sessions.map((s) => s.session));
  for (const p of presence) {
    if (!p.connected || traced.has(p.session)) continue;
    out.push({
      session: p.session,
      client: p.client,
      startedAt: p.connectedAt,
      endedAt: p.connectedAt,
      entries: [],
      reads: 0,
      writes: 0,
      errors: 0,
      connected: true,
      connectedAt: p.connectedAt,
      disconnectedAt: null,
      label: p.label ?? null,
      clientSession: p.clientSession ?? null,
      cwd: p.cwd ?? null,
      inferred: p.matched === "inferred",
    });
  }
  return out.sort(
    (a, b) => Number(b.connected) - Number(a.connected) || b.endedAt - a.endedAt,
  );
}

/** One note per conversation. `doing` is the call a conversation is in the
 *  middle of, if any: its row says that, and settles back to the summary. */
export function buildAgentNotes(
  conversations: AgentConversation[],
  doing: (session: string) => AgentActivity | null = () => null,
): Note[] {
  return conversations.map((s) => {
    const now = doing(s.session);
    return {
      id: agentNoteId(s.session),
      title: agentName(s.client, s.label),
      // Only the list row ever shows this; opening the note renders the trace.
      body: now
        ? describeActivity(now)
        : sessionSummary(s) || (s.connected ? "Connected. Nothing asked yet." : ""),
      createdAt: new Date(s.startedAt).toISOString(),
      updatedAt: new Date(s.endedAt).toISOString(),
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      contentKind: "document" as const,
    };
  });
}
