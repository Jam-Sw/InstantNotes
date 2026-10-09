import type { Note } from "$lib/api/types";
import {
  agentKind,
  agentName,
  describeActivity,
  type AgentActivity,
  type AgentPresence,
  type AgentSession,
} from "$lib/agent-activity";

export const AGENTS_SPACE_ID = "agents-space";
export const AGENTS_SPACE_NAME = "Agents";
const NOTE_PREFIX = "agent-session:";

export function isAgentsSpaceId(id: string | null | undefined): boolean {
  return id === AGENTS_SPACE_ID;
}

export function isAgentNoteId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(NOTE_PREFIX);
}

/** @internal */
export function agentNoteId(session: string): string {
  return NOTE_PREFIX + session;
}

export function sessionOfNote(id: string | null | undefined): string | null {
  return id && isAgentNoteId(id) ? id.slice(NOTE_PREFIX.length) : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** @internal */
export function sessionSummary(s: AgentSession): string {
  const parts: string[] = [];
  if (s.writes) parts.push(plural(s.writes, "change", "changes"));
  if (s.reads) parts.push(plural(s.reads, "read", "reads"));
  if (s.errors) parts.push(`${s.errors} failed`);
  return parts.join(" · ");
}

export interface AgentClock {
  session: string;
  inAt: number | null;
  outAt: number | null;
}

export interface AgentConversation extends AgentSession {
  connected: boolean;
  clocks: AgentClock[];
  label: string | null;
  clientSession: string | null;
  cwd: string | null;
  inferred: boolean;
}

export function joinConversations(
  sessions: AgentSession[],
  presence: AgentPresence[],
): AgentConversation[] {
  const known = new Map(presence.map((p) => [p.session, p]));
  const out: AgentConversation[] = sessions.map((s) => {
    const p = known.get(s.session);
    return {
      ...s,
      client: p?.client ?? s.client,
      connected: p?.connected ?? false,
      clocks: [
        {
          session: s.session,
          inAt: p?.connectedAt ?? null,
          outAt: p?.connected ? null : (p?.disconnectedAt ?? s.endedAt),
        },
      ],
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
      clocks: [{ session: p.session, inAt: p.connectedAt, outAt: null }],
      label: p.label ?? null,
      clientSession: p.clientSession ?? null,
      cwd: p.cwd ?? null,
      inferred: p.matched === "inferred",
    });
  }
  const order = (a: AgentConversation, b: AgentConversation) =>
    Number(b.connected) - Number(a.connected) || b.endedAt - a.endedAt;
  const leads = new Map<string, AgentConversation>();
  const merged: AgentConversation[] = [];
  for (const c of out.sort(order)) {
    const key = c.clientSession && `${agentKind(c.client)}:${c.clientSession}`;
    const lead = key ? leads.get(key) : undefined;
    if (!lead) {
      if (key) leads.set(key, c);
      merged.push(c);
      continue;
    }
    lead.entries = [...lead.entries, ...c.entries].sort((a, b) => b.seq - a.seq);
    lead.startedAt = Math.min(lead.startedAt, c.startedAt);
    lead.endedAt = Math.max(lead.endedAt, c.endedAt);
    lead.reads += c.reads;
    lead.writes += c.writes;
    lead.errors += c.errors;
    lead.clocks = [...lead.clocks, ...c.clocks];
  }
  for (const c of merged) c.clocks.sort((a, b) => (a.inAt ?? 0) - (b.inAt ?? 0));
  return merged.sort(order);
}

export function buildAgentNotes(
  conversations: AgentConversation[],
  doing: (session: string) => AgentActivity | null = () => null,
): Note[] {
  return conversations.map((s) => {
    const now = doing(s.session);
    return {
      id: agentNoteId(s.clocks[0]?.session ?? s.session),
      title: agentName(s.client, s.label),
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
