import { agents } from "$lib/stores/agents.svelte";
import { library } from "$lib/stores/library.svelte";
import { groupSessions } from "$lib/agent-activity";
import {
  AGENTS_SPACE_ID,
  buildAgentNotes,
  joinConversations,
  sessionOfNote,
  type AgentConversation,
} from "$lib/agents/space";
import type { Note } from "$lib/api/types";

export const agentsSpace = {
  get visible(): boolean {
    return agents.access !== "off" || agents.recent.length > 0 || agents.connectedCount > 0;
  },
  get sessions(): AgentConversation[] {
    return joinConversations(groupSessions(agents.recent), agents.sessions);
  },
  get notes(): Note[] {
    return buildAgentNotes(this.sessions, (s) => agents.doing(s));
  },
  stateOf(noteId: string | null | undefined): "working" | "connected" | null {
    const s = this.sessionFor(noteId);
    if (!s?.connected) return null;
    return agents.doing(s.session) ? "working" : "connected";
  },
  sessionFor(noteId: string | null | undefined): AgentConversation | null {
    const session = sessionOfNote(noteId);
    return session ? (this.sessions.find((s) => s.clocks.some((c) => c.session === session)) ?? null) : null;
  },
  open(): void {
    library.selectWorkspace(AGENTS_SPACE_ID);
    const lead = this.notes[0];
    if (lead) library.selectVirtual(lead);
  },
};
